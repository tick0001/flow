import type { ExecutionEvent } from '@flow/contracts';
import type { RequestContext } from '@flow/db';
import type { Depot } from './depot.js';
import { journalDe } from './log.js';

const log = journalDe('Progression');

/**
 * Cadence d'ecriture de la progression.
 *
 * La progression est un **etat** qu'on ecrase, pas un historique qu'on empile :
 * seule la derniere valeur compte. Un bot qui appelle `progress()` dans une
 * boucle de mille iterations produirait mille mises a jour de la meme ligne, dont
 * neuf cent quatre-vingt-dix-neuf que personne ne verra jamais.
 */
const PERIODE_MS = 200;

/**
 * L'etape en cours d'une execution.
 *
 * Le SDK promet un `progress()` **synchrone** : un bot l'appelle sans `await`, et
 * rendre une promesse ici ferait que la moitie des etapes ne seraient jamais
 * ecrites -- silencieusement, puisque personne ne l'attendrait.
 */
export class Progression {
  private attente: { step: string; percent: number | null } | undefined;
  private minuteur: NodeJS.Timeout | undefined;
  private enCours: Promise<void> = Promise.resolve();

  constructor(
    private readonly depot: Depot,
    private readonly context: RequestContext,
    private readonly executionId: string,
    /** Diffuse l'etape **deja ecrite**. Meme invariant que pour le journal. */
    private readonly publier: (evenement: ExecutionEvent) => void,
  ) {}

  annoncer(step: string, percent?: number): void {
    // Le pourcentage est facultatif, et le rester jusqu'en base : beaucoup de bots
    // savent nommer leur etape sans savoir combien il reste, et remplacer l'absence
    // par un zero afficherait une barre vide a chaque etape.
    this.attente = { step: step.slice(0, 200), percent: percent ?? null };

    this.minuteur ??= setTimeout(() => {
      this.minuteur = undefined;
      void this.ecrire();
    }, PERIODE_MS);
  }

  /** Ecrit la derniere valeur connue, s'il y en a une en attente. */
  async ecrire(): Promise<void> {
    const valeur = this.attente;

    if (!valeur) return;

    this.attente = undefined;

    this.enCours = this.enCours.then(async () => {
      try {
        await this.depot.progresser(this.context, this.executionId, valeur.step, valeur.percent);

        this.publier({
          kind: 'progress',
          payload: { executionId: this.executionId, step: valeur.step, percent: valeur.percent },
        });
      } catch (erreur: unknown) {
        // Comme pour le journal : une progression perdue ne doit pas priver
        // l'execution de sa fin.
        log.error(`Progression perdue pour ${this.executionId} : ${String(erreur)}`);
      }
    });

    await this.enCours;
  }

  /** Ecrit la derniere etape et arrete le minuteur. */
  async fermer(): Promise<void> {
    if (this.minuteur) {
      clearTimeout(this.minuteur);
      this.minuteur = undefined;
    }

    await this.ecrire();
  }
}
