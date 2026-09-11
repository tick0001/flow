import type { ExecutionEvent, LogLevel } from '@flow/contracts';
import type { RequestContext } from '@flow/db';
import type { Depot, LigneDeJournal } from './depot.js';
import { journalDe } from './log.js';
import { assainirMessage } from './message.js';

const log = journalDe('Journal');

/**
 * Ecart maximal entre l'appel a `log()` d'un bot et l'ecriture en base.
 *
 * Une insertion par ligne serait « au fil de l'eau » au sens strict et
 * intenable : un bot qui journalise dans une boucle produirait une transaction
 * par ligne. Deux cents millisecondes sont imperceptibles pour qui regarde un
 * journal defiler, et ramenent une rafale a une seule insertion groupee.
 *
 * Ce que le tampon coute : les lignes des deux cents dernieres millisecondes si
 * le processus est tue net. On ne perd donc pas un journal, on en perd la fin --
 * et la ligne qui manquerait le plus est celle de l'echec, qui passe par
 * `fermer()` et n'attend pas le minuteur.
 */
const PERIODE_MS = 200;

/**
 * Longueur maximale d'une ligne.
 *
 * Un bot qui journalise le corps d'une reponse HTTP entiere ecrirait des
 * mega-octets par ligne dans la table qui grossit le plus vite du schema. La
 * coupure est annoncee dans la ligne elle-meme : une troncature muette ferait
 * chercher longtemps pourquoi une trace s'arrete au milieu d'un mot.
 */
const LONGUEUR_MAX = 10_000;

/**
 * Le journal d'une execution : tampon, rang, et ecriture groupee.
 *
 * Le rang est attribue **a l'appel** et non a l'ecriture. C'est ce qui garantit
 * l'ordre : deux lignes emises dans la meme milliseconde -- ce qui arrive des
 * qu'un bot journalise en boucle -- s'afficheraient autrement dans un ordre
 * arbitraire, et la reprise apres coupure du client n'aurait aucun point fixe.
 *
 * Le worker est a tout instant le seul ecrivain d'une execution donnee : le
 * compteur peut donc vivre en memoire. Une sequence PostgreSQL aurait ete globale
 * a la table, donc trouee et sans signification a l'interieur d'une execution.
 */
export class Journal {
  private tampon: LigneDeJournal[] = [];
  private suivant = 0;
  private minuteur: NodeJS.Timeout | undefined;
  /** Chaine des ecritures : deux vidages simultanes inseraient dans le desordre. */
  private enCours: Promise<void> = Promise.resolve();

  constructor(
    private readonly depot: Depot,
    private readonly context: RequestContext,
    private readonly executionId: string,
    /**
     * Diffuse une ligne **deja ecrite**.
     *
     * Appele depuis le vidage et jamais depuis `ecrire`, et c'est l'invariant du
     * temps reel : rien n'est diffuse qui ne soit deja en base. Une ligne
     * diffusee mais perdue avant d'etre persistee disparaitrait pour de bon --
     * un client qui se reconnecte redemande a la base « ce qui suit le rang n »,
     * et elle ne l'aurait jamais eue.
     */
    private readonly publier: (evenement: ExecutionEvent) => void,
  ) {}

  /**
   * Ajoute une ligne. Synchrone a dessein.
   *
   * Un bot appelle `log()` sans `await` -- c'est ce que le SDK promet. Rendre une
   * promesse ici ferait que la moitie des lignes ne seraient jamais ecrites,
   * silencieusement, parce que personne ne l'attendrait.
   */
  ecrire(level: LogLevel, message: string): void {
    // Assaini avant d'etre borne : un bot peut journaliser la sortie coloree
    // d'un outil, et les codes d'echappement ne sont invisibles que dans un
    // terminal -- pas en base, pas dans l'interface.
    const propre = assainirMessage(message);
    const tronque =
      propre.length > LONGUEUR_MAX
        ? `${propre.slice(0, LONGUEUR_MAX)}… (ligne tronquee, ${String(propre.length)} caracteres)`
        : propre;

    this.tampon.push({ seq: this.suivant, at: new Date(), level, message: tronque });
    this.suivant += 1;

    this.minuteur ??= setTimeout(() => {
      this.minuteur = undefined;
      void this.vider();
    }, PERIODE_MS);
  }

  /** Ecrit ce qui attend. */
  async vider(): Promise<void> {
    if (this.tampon.length === 0) return;

    const paquet = this.tampon;

    this.tampon = [];

    this.enCours = this.enCours.then(async () => {
      try {
        await this.depot.journaliser(this.context, this.executionId, paquet);

        for (const ligne of paquet) {
          this.publier({ kind: 'log', payload: { executionId: this.executionId, ...ligne } });
        }
      } catch (erreur: unknown) {
        // Un journal qu'on ne peut pas ecrire ne doit pas faire echouer
        // l'execution : le bot fait peut-etre un travail qui compte, et le priver
        // de sa fin parce qu'une ligne de trace n'est pas passee serait un mauvais
        // echange. On le dit dans les journaux du processus, ou un exploitant le
        // verra.
        log.error(`Journal perdu pour ${this.executionId} : ${String(erreur)}`);
      }
    });

    await this.enCours;
  }

  /** Vide et arrete le minuteur. Le denouement passe par ici avant d'etre pose. */
  async fermer(): Promise<void> {
    if (this.minuteur) {
      clearTimeout(this.minuteur);
      this.minuteur = undefined;
    }

    await this.vider();
  }
}
