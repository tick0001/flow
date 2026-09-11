import { mkdir, readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionJob, ExecutionStatus } from '@flow/contracts';
import { loadEnv, resolveFromRoot } from './config/env.js';
import type { Depot, Denouement, ExecutionReclamee } from './depot.js';
import { Journal } from './journal.js';
import { journalDe } from './log.js';
import type { Navigateurs } from './navigateur.js';
import { Progression } from './progression.js';
import { chargerBot } from './registre.js';

const log = journalDe('Executeur');

/** Longueur maximale d'un message de denouement, alignee sur le contrat. */
const MESSAGE_MAX = 2000;

/**
 * Pourquoi une execution a ete interrompue de l'exterieur.
 *
 * Trois causes, trois denouements differents, et les confondre serait perdre
 * l'information la plus utile de la trace : **quelqu'un** a demande la premiere,
 * **le temps** a arrete la deuxieme, **la machine** a emporte la troisieme.
 * Afficher « interrompue » dans les trois cas ferait chercher un utilisateur
 * capricieux la ou il faut lire les journaux du conteneur.
 */
export type Interruption = 'annulation' | 'delai' | 'arret';

interface EnCours {
  abandon: AbortController;
  demarre: number;
  interruption: Interruption | undefined;
  /** Ferme le contexte navigateur. C'est ce qui interrompt reellement un bot. */
  fermerContexte: (() => Promise<void>) | undefined;
  minuteur: NodeJS.Timeout;
}

/**
 * Le cycle de vie d'une execution, d'un bout a l'autre.
 *
 * Ce fichier est le coeur du jalon J3, et l'ordre des operations y est le sujet :
 * reclamer avant de faire quoi que ce soit, ouvrir le contexte navigateur avant
 * de laisser le bot demarrer, et **toujours** poser un denouement -- meme quand
 * tout se passe mal. Une execution sans denouement reste `running` pour
 * l'eternite, et c'est exactement l'etat que personne ne sait interpreter.
 */
export class Executeur {
  private readonly enCours = new Map<string, EnCours>();

  constructor(
    private readonly depot: Depot,
    private readonly navigateurs: Navigateurs,
  ) {}

  /** Les executions que ce worker detient. Interroge par le battement de coeur. */
  detenues(): string[] {
    return [...this.enCours.keys()];
  }

  /**
   * Execute un travail, du debut a la fin.
   *
   * Ne leve jamais : un travail qui echoue cote BullMQ serait remis en file par
   * la mecanique de reprise, et un bot n'est pas idempotent. L'echec est un
   * denouement en base, pas une exception qui remonte.
   */
  async executer(job: ExecutionJob): Promise<void> {
    const reclamee = await this.depot.reclamer(job.executionId);

    if (!reclamee) {
      // Trois causes possibles, et aucune n'est une panne : un autre worker l'a
      // prise, elle a ete annulee avant de demarrer, ou ce travail est une
      // redistribution apres la mort d'un worker -- auquel cas l'execution est
      // encore `running` et le balayage s'en occupera. Dans les trois cas, ne
      // rien faire est la bonne reponse.
      log.debug(`${job.executionId} : rien a reclamer, ignoree.`);

      return;
    }

    const env = loadEnv();
    const journal = new Journal(this.depot, reclamee.context, reclamee.id);
    const progression = new Progression(this.depot, reclamee.context, reclamee.id);
    const abandon = new AbortController();
    const demarre = Date.now();

    const suivi: EnCours = {
      abandon,
      demarre,
      interruption: undefined,
      fermerContexte: undefined,
      minuteur: setTimeout(() => {
        this.interrompre(reclamee.id, 'delai');
      }, env.WORKER_RUN_TIMEOUT_SECONDS * 1000),
    };

    this.enCours.set(reclamee.id, suivi);
    log.log(`${reclamee.id} : ${reclamee.botId} demarre.`);

    let denouement: Denouement;

    try {
      denouement = await this.derouler(reclamee, journal, progression, suivi);
    } catch (erreur: unknown) {
      denouement = this.denouementDErreur(erreur, suivi, demarre, env.WORKER_RUN_TIMEOUT_SECONDS);
    } finally {
      clearTimeout(suivi.minuteur);
      this.enCours.delete(reclamee.id);

      if (suivi.fermerContexte) {
        try {
          await suivi.fermerContexte();
        } catch (erreur: unknown) {
          // Un contexte deja ferme -- ce qui est le cas apres une interruption --
          // ou un navigateur mort. Rien a rattraper : l'execution est finie.
          log.debug(`${reclamee.id} : fermeture du contexte : ${String(erreur)}`);
        }
      }
    }

    // Le journal et la progression avant le denouement : quand l'interface voit
    // un etat terminal, elle arrete de relire, et une ligne ecrite apres ne
    // serait jamais affichee.
    await progression.fermer();
    await journal.fermer();
    await this.depot.terminer(reclamee.context, reclamee.id, denouement);

    log.log(
      `${reclamee.id} : ${denouement.status} en ${String(Math.round(denouement.durationMs / 1000))} s.`,
    );
  }

  /**
   * Demande l'interruption d'une execution que ce worker detient.
   *
   * **Deux gestes et non un.** Le signal est ce qu'un bot bien ecrit consulte
   * entre deux etapes ; la fermeture du contexte navigateur est ce qui arrete
   * reellement un bot suspendu dans un `waitForSelector`. Playwright n'ecoute
   * aucun `AbortSignal` : sans la fermeture, un bot qui attend un element qui
   * n'arrivera jamais resterait bloque jusqu'a son delai d'attente, l'annulation
   * affichee et sans effet.
   *
   * Synchrone, parce qu'elle est appelee depuis un message Redis et depuis un
   * minuteur : rien n'attend son resultat.
   */
  interrompre(executionId: string, raison: Interruption): void {
    const suivi = this.enCours.get(executionId);

    if (!suivi) return;
    // La premiere raison gagne : un arret du worker survenant apres une
    // annulation ne doit pas requalifier la trace.
    if (suivi.interruption) return;

    suivi.interruption = raison;
    log.log(`${executionId} : interruption demandee (${raison}).`);
    suivi.abandon.abort();

    if (suivi.fermerContexte) {
      void suivi.fermerContexte().catch((erreur: unknown) => {
        log.debug(`${executionId} : fermeture du contexte : ${String(erreur)}`);
      });
    }
  }

  /**
   * Interrompt tout et attend que les denouements soient poses.
   *
   * Appele a l'arret du worker. Les executions sont marquees `abandoned` -- pas
   * `cancelled`, personne ne les a demandees -- et **non remises en file** : un
   * bot a peut-etre deja valide un formulaire, et le rejouer le validerait deux
   * fois. Reprendre est une decision humaine.
   */
  async abandonnerTout(): Promise<void> {
    const identifiants = this.detenues();

    for (const id of identifiants) {
      this.interrompre(id, 'arret');
    }

    // Les denouements sont poses par les runs eux-memes, qui se terminent sur la
    // fermeture de leur contexte. On leur laisse un instant, puis on tranche :
    // une execution dont le denouement n'est pas arrive resterait `running`, et
    // il vaut mieux un `abandoned` pose de force qu'un etat qui ne bougera plus.
    await new Promise((resoudre) => setTimeout(resoudre, 2000));

    for (const id of identifiants) {
      if (!this.enCours.has(id)) continue;

      const suivi = this.enCours.get(id);

      await this.depot.terminerSansContexte(id, {
        status: 'abandoned',
        message: 'Worker arrete pendant cette execution.',
        output: null,
        durationMs: Date.now() - (suivi?.demarre ?? Date.now()),
      });
    }
  }

  // --- interne ---------------------------------------------------------------

  private async derouler(
    reclamee: ExecutionReclamee,
    journal: Journal,
    progression: Progression,
    suivi: EnCours,
  ): Promise<Denouement> {
    const env = loadEnv();
    const { bot, manifest } = await chargerBot(reclamee.botId);

    journal.ecrire('info', `${manifest.name} v${manifest.version} (${manifest.id}).`);

    // **La validation qui fait foi.** Celle de l'API porte sur le JSON Schema
    // derive, qui ne sait pas exprimer tout ce qu'un schema Zod exprime : c'est
    // ici que les raffinements, les dependances entre champs et les formats
    // maison s'appliquent.
    const lecture = bot.parameters.safeParse(reclamee.parameters);

    if (!lecture.success) {
      const details = lecture.error.issues
        .map((probleme) => `${probleme.path.join('.') || '(racine)'} : ${probleme.message}`)
        .join(' ; ');

      journal.ecrire('error', `Parametres refuses par le bot : ${details}`);

      return {
        status: 'failed',
        message: `Parametres invalides : ${details}`,
        output: null,
        durationMs: Date.now() - suivi.demarre,
      };
    }

    const sansFenetre = !(reclamee.headed && env.WORKER_HEADED);

    if (reclamee.headed && !env.WORKER_HEADED) {
      // Dit dans le journal de l'execution et non dans celui du processus : c'est
      // la personne qui a coche la case qui doit l'apprendre, et elle ne lira
      // jamais les journaux du conteneur.
      journal.ecrire(
        'warning',
        'Vue avec fenetre demandee, mais ce worker ne peut pas en ouvrir : execution sans fenetre.',
      );
    }

    const { context, page } = await this.navigateurs.ouvrirContexte(sansFenetre);

    suivi.fermerContexte = () => context.close();

    // Si l'interruption est arrivee pendant l'ouverture du navigateur, le
    // contexte vient de naitre apres l'abandon : personne ne l'aurait ferme.
    if (suivi.abandon.signal.aborted) await context.close();

    const outputDir = await this.preparerDossier(reclamee.id);

    const resultat = await bot.run({
      params: lecture.data,
      page,
      log: (level, message) => {
        journal.ecrire(level, message);
      },
      progress: (step, percent) => {
        progression.annoncer(step, percent);
      },
      signal: suivi.abandon.signal,
      outputDir,
    });

    await this.rangerDossier(outputDir, journal);

    // L'interruption d'abord, meme quand le bot a rendu la main proprement : il a
    // vu le signal et s'est arrete, ce qui est le comportement attendu -- pas une
    // reussite.
    if (suivi.interruption) {
      return this.denouementDInterruption(
        suivi.interruption,
        suivi.demarre,
        env.WORKER_RUN_TIMEOUT_SECONDS,
      );
    }

    return {
      status: 'succeeded',
      message: resultat?.message ? tronquer(resultat.message) : null,
      output: resultat?.output ?? null,
      durationMs: Date.now() - suivi.demarre,
    };
  }

  private denouementDErreur(
    erreur: unknown,
    suivi: EnCours,
    demarre: number,
    delaiSecondes: number,
  ): Denouement {
    if (suivi.interruption) {
      return this.denouementDInterruption(suivi.interruption, demarre, delaiSecondes);
    }

    const message = erreur instanceof Error ? erreur.message : String(erreur);

    log.warn(`Echec : ${message}`);

    return {
      status: 'failed',
      message: tronquer(message),
      output: null,
      durationMs: Date.now() - demarre,
    };
  }

  private denouementDInterruption(
    raison: Interruption,
    demarre: number,
    delaiSecondes: number,
  ): Denouement {
    const durationMs = Date.now() - demarre;

    const statuts: Record<Interruption, ExecutionStatus> = {
      annulation: 'cancelled',
      delai: 'failed',
      arret: 'abandoned',
    };

    const messages: Record<Interruption, string | null> = {
      // Le statut dit tout : « interrompue » et le nom de qui l'a demandee
      // suffisent, et une phrase en francais en base serait lue par quelqu'un qui
      // travaille en anglais.
      annulation: null,
      delai: `Duree maximale depassee (${String(delaiSecondes)} s).`,
      arret: 'Worker arrete pendant cette execution.',
    };

    return {
      status: statuts[raison],
      message: messages[raison],
      output: null,
      durationMs,
    };
  }

  /** Cree le dossier de sortie de l'execution, tel que le SDK le promet. */
  private async preparerDossier(executionId: string): Promise<string> {
    const chemin = join(resolveFromRoot(loadEnv().WORKER_OUTPUT_PATH), executionId);

    await mkdir(chemin, { recursive: true });

    return chemin;
  }

  /**
   * Retire le dossier de sortie s'il est vide, le signale sinon.
   *
   * La plupart des bots n'y ecrivent rien : garder un dossier vide par execution
   * remplirait le disque d'entrees inutiles, que personne ne penserait a nettoyer.
   * Un dossier qui contient quelque chose reste -- le versement au stockage de
   * fichiers arrive au jalon J5, et effacer en attendant perdrait une capture que
   * le bot a pris la peine de produire.
   */
  private async rangerDossier(chemin: string, journal: Journal): Promise<void> {
    try {
      const contenu = await readdir(chemin);

      if (contenu.length === 0) {
        await rmdir(chemin);

        return;
      }

      journal.ecrire(
        'info',
        `${String(contenu.length)} fichier(s) dans le dossier de sortie (${chemin}).`,
      );
    } catch (erreur: unknown) {
      log.debug(`Rangement du dossier de sortie : ${String(erreur)}`);
    }
  }
}

function tronquer(message: string): string {
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message;
}
