import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ExecutionJob, ExecutionStatus } from '@flow/contracts';
import { loadEnv, resolveFromRoot } from './config/env.js';
import type { Depot, Denouement, ExecutionReclamee } from './depot.js';
import { Journal } from './journal.js';
import { journalDe } from './log.js';
import type { Diffusion } from './diffusion.js';
import type { BrowserContext } from 'playwright';
import type { FileStore } from '@flow/storage';
import type { Navigateurs } from './navigateur.js';
import { Progression } from './progression.js';
import { Recolte } from './pieces.js';
import { Screencast } from './screencast.js';
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
  /** La vue en direct, ouverte seulement si quelqu'un regarde. */
  screencast: Screencast | undefined;
  /**
   * Recolte les pieces pendant que le navigateur vit encore.
   *
   * Portee ici parce qu'elle doit tourner **avant** la fermeture du contexte :
   * une capture se prend sur une page ouverte, et une trace s'arrete sur un
   * contexte vivant.
   */
  recolter: ((echec: boolean) => Promise<void>) | undefined;
  /**
   * Dossier de sortie, range a la fin quoi qu'il arrive.
   *
   * Porte ici et non dans le deroulement, parce que c'est la seule facon de le
   * ranger aussi quand le bot leve : un echec ou une interruption laissaient
   * autrement un dossier vide par execution, pour toujours.
   */
  outputDir: string | undefined;
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
    private readonly diffusion: Diffusion,
    private readonly stockage: FileStore,
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
    const publier = (evenement: Parameters<Diffusion['publier']>[1]): void => {
      this.diffusion.publier(reclamee.id, evenement);
    };
    const journal = new Journal(this.depot, reclamee.context, reclamee.id, publier);
    const progression = new Progression(this.depot, reclamee.context, reclamee.id, publier);
    const abandon = new AbortController();
    const demarre = Date.now();

    const suivi: EnCours = {
      abandon,
      demarre,
      interruption: undefined,
      fermerContexte: undefined,
      screencast: undefined,
      recolter: undefined,
      outputDir: undefined,
      minuteur: setTimeout(() => {
        this.interrompre(reclamee.id, 'delai');
      }, env.WORKER_RUN_TIMEOUT_SECONDS * 1000),
    };

    this.enCours.set(reclamee.id, suivi);
    log.log(`${reclamee.id} : ${reclamee.botId} demarre.`);
    publier({ kind: 'status', payload: { executionId: reclamee.id, status: 'running' } });

    let denouement: Denouement;

    try {
      denouement = await this.derouler(reclamee, journal, progression, suivi, publier);
    } catch (erreur: unknown) {
      denouement = this.denouementDErreur(erreur, suivi, demarre, env.WORKER_RUN_TIMEOUT_SECONDS);
    }

    // Pas de `finally` ici, et c'est voulu : la suite a besoin du denouement, que
    // TypeScript ne considere pose qu'une fois les deux branches passees. Ni
    // l'une ni l'autre ne releve, si bien qu'on arrive toujours ici.
    clearTimeout(suivi.minuteur);
    this.enCours.delete(reclamee.id);

    // La vue en direct avant le reste : fermer le contexte d'abord emporterait la
    // session CDP, et l'arret se plaindrait dans le vide.
    if (suivi.screencast) await suivi.screencast.arreter();

    // **La recolte avant la fermeture du contexte, et c'est l'ordre qui compte** :
    // une capture se prend sur une page ouverte, une trace s'arrete sur un
    // contexte vivant. Apres, il n'y a plus rien a photographier.
    if (suivi.recolter) {
      try {
        await suivi.recolter(denouement.status !== 'succeeded');
      } catch (erreur: unknown) {
        // Une piece perdue ne prive pas l'execution de son denouement.
        log.warn(`${reclamee.id} : recolte incomplete : ${String(erreur)}`);
      }
    }

    if (suivi.fermerContexte) {
      try {
        await suivi.fermerContexte();
      } catch (erreur: unknown) {
        // Un contexte deja ferme -- ce qui est le cas apres une interruption --
        // ou un navigateur mort. Rien a rattraper : l'execution est finie.
        log.debug(`${reclamee.id} : fermeture du contexte : ${String(erreur)}`);
      }
    }

    // Le journal et la progression avant le denouement : quand l'interface voit
    // un etat terminal, elle arrete de relire, et une ligne ecrite apres ne
    // serait jamais affichee.
    await progression.fermer();
    await journal.fermer();
    await this.depot.terminer(reclamee.context, reclamee.id, denouement);

    // Apres l'ecriture, jamais avant : un client qui recoit l'etat terminal
    // redemande le detail dans la foulee, et le trouverait encore « en cours ».
    publier({ kind: 'status', payload: { executionId: reclamee.id, status: denouement.status } });
    this.diffusion.oublierRegard(reclamee.id);

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
    publier: (evenement: Parameters<Diffusion['publier']>[1]) => void,
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

    // La trace demarre avant le bot : ce qu'elle n'a pas enregistre n'existe pas.
    // `sources: false` : la trace embarquerait sinon le code du bot, qui
    // appartient a son auteur et n'a rien a faire dans le stockage de
    // l'installation.
    if (env.WORKER_TRACE) {
      try {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      } catch (erreur: unknown) {
        journal.ecrire('warning', `Trace indisponible : ${String(erreur)}`);
      }
    }

    // Si l'interruption est arrivee pendant l'ouverture du navigateur, le
    // contexte vient de naitre apres l'abandon : personne ne l'aurait ferme.
    if (suivi.abandon.signal.aborted) await context.close();

    // **La vue en direct ne s'ouvre que si quelqu'un regarde**, et se referme
    // quand la derniere personne s'en va. Encoder des images que personne ne
    // recoit prendrait du processeur sur l'execution elle-meme -- ce que faisait
    // l'outil remplace, qui poussait une capture toutes les 800 ms a chaque
    // session ouverte.
    const screencast = new Screencast(page, (image) => {
      publier({ kind: 'frame', payload: { executionId: reclamee.id, ...image } });
    });

    suivi.screencast = screencast;

    const suivreLeRegard = (): void => {
      if (this.diffusion.estRegardee(reclamee.id)) void screencast.demarrer();
      else void screencast.arreter();
    };

    this.diffusion.surRegard(reclamee.id, suivreLeRegard);
    suivreLeRegard();

    const outputDir = await this.preparerDossier(reclamee.id);

    suivi.outputDir = outputDir;

    const recolte = new Recolte(this.depot, this.stockage, reclamee.context, reclamee.id);

    suivi.recolter = async (echec: boolean): Promise<void> => {
      // **La capture n'est prise qu'en cas d'echec.** Une capture par execution
      // reussie remplirait le stockage de pages qui se sont bien passees, et
      // c'est l'echec qu'on vient regarder.
      if (echec) {
        try {
          const image = await page.screenshot({ fullPage: true });

          if (await recolte.deposer('screenshot', 'echec.png', 'image/png', image)) {
            journal.ecrire('info', "Capture de l'ecran au moment de l'echec.");
          }
        } catch (erreur: unknown) {
          // Le cas courant : la page est deja fermee. Une interruption ferme le
          // contexte navigateur pour arreter le bot -- c'est ce qui l'arrete
          // vraiment -- et il n'y a alors plus rien a photographier.
          journal.ecrire('debug', `Pas de capture : ${String(erreur)}`);
        }
      }

      await this.recolterLaTrace(context, recolte, journal, echec);

      const verses = await recolte.verserLeDossier(outputDir);

      if (verses > 0) {
        journal.ecrire(
          'info',
          `${String(verses)} fichier(s) verse(s) depuis le dossier de sortie.`,
        );
      }

      // Le dossier de travail disparait dans tous les cas : ce qui compte est
      // desormais dans le stockage, et le garder ferait grossir sans fin le
      // disque du worker.
      await rm(outputDir, { recursive: true, force: true });
      suivi.outputDir = undefined;
    };

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
   * Arrete la trace et la garde si elle sert.
   *
   * **Gardee seulement en cas d'echec.** Une trace de run reussi ne sert a
   * personne et pese des mega-octets : en conserver une par execution remplirait
   * le stockage de rejeux que personne n'ouvrira jamais.
   *
   * Elle est ecrite dans un fichier temporaire avant d'etre versee, parce que
   * Playwright ne sait l'ecrire que sur un chemin. Le fichier est retire ensuite,
   * y compris quand le versement echoue -- sinon un echec de stockage laisserait
   * grossir le dossier temporaire de la machine sans que rien ne le dise.
   */
  private async recolterLaTrace(
    context: BrowserContext,
    recolte: Recolte,
    journal: Journal,
    echec: boolean,
  ): Promise<void> {
    if (!loadEnv().WORKER_TRACE) return;

    if (!echec) {
      // Arretee sans chemin : Playwright jette ce qu'elle a enregistre.
      await context.tracing.stop().catch(() => undefined);

      return;
    }

    const chemin = join(tmpdir(), `flow-trace-${randomUUID()}.zip`);

    try {
      await context.tracing.stop({ path: chemin });

      if (await recolte.deposerFichier('trace', chemin, 'trace.zip')) {
        journal.ecrire(
          'info',
          "Trace Playwright enregistree : elle rejoue l'execution action par action.",
        );
      }
    } catch (erreur: unknown) {
      journal.ecrire('debug', `Trace non conservee : ${String(erreur)}`);
    } finally {
      await rm(chemin, { force: true });
    }
  }
}

function tronquer(message: string): string {
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message;
}
