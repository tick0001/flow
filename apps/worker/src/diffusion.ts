import { Redis } from 'ioredis';
import {
  CANAL_REGARD,
  REGARD_PERIME_MS,
  REGARD_RAPPEL_MS,
  canalExecution,
  watchOrderSchema,
  type ExecutionEvent,
} from '@flow/contracts';
import { loadEnv } from './config/env.js';
import { journalDe } from './log.js';

const log = journalDe('Diffusion');

/**
 * Ce que le worker publie, et ce qu'il apprend en retour.
 *
 * **Invariant : rien n'est diffuse qui ne soit deja en base.** Le journal et la
 * progression sont publies depuis l'ecriture, jamais depuis l'appel du bot. Sans
 * cette regle, une ligne diffusee puis perdue avant d'etre persistee
 * disparaitrait pour de bon : un client qui se reconnecte redemande « ce qui suit
 * le rang n » a la base, qui ne l'aurait jamais eue. Le prix est un retard de
 * deux cents millisecondes, imperceptible a la lecture.
 *
 * Les images font exception, et c'est leur nature : elles ne sont persistees
 * nulle part, et une image manquee n'a aucun interet a etre rattrapee.
 */
export class Diffusion {
  private readonly publieur: Redis;
  private readonly abonne: Redis;

  /** Date du dernier signal « on regarde », par execution. */
  private readonly regards = new Map<string, number>();
  private readonly ecouteurs = new Map<string, () => void>();
  private peremption: NodeJS.Timeout | undefined;

  constructor() {
    const url = loadEnv().REDIS_URL;

    this.publieur = new Redis(url);
    this.abonne = new Redis(url);

    for (const [nom, client] of [
      ['publication', this.publieur],
      ['regards', this.abonne],
    ] as const) {
      client.on('error', (erreur: Error) => {
        log.warn(`Redis (${nom}) : ${erreur.message}`);
      });
    }
  }

  async demarrer(): Promise<void> {
    await this.abonne.subscribe(CANAL_REGARD);

    this.abonne.on('message', (_canal: string, contenu: string) => {
      const lecture = watchOrderSchema.safeParse(JSON.parse(contenu));

      if (!lecture.success) return;

      const { executionId, watchers } = lecture.data;
      const regardeAvant = this.estRegardee(executionId);

      if (watchers > 0) this.regards.set(executionId, Date.now());
      else this.regards.delete(executionId);

      if (regardeAvant !== this.estRegardee(executionId)) this.prevenir(executionId);
    });

    // Le signal se repete tant qu'on regarde ; son absence prolongee vaut donc
    // « plus personne ». C'est ce qui rattrape une instance d'API morte pendant
    // qu'un lecteur regardait : sans cela, le worker encoderait des images pour
    // un navigateur qui n'est plus la, jusqu'a la fin du run.
    this.peremption = setInterval(() => {
      for (const [executionId, vu] of this.regards) {
        if (Date.now() - vu <= REGARD_PERIME_MS) continue;

        this.regards.delete(executionId);
        log.debug(`${executionId} : plus personne ne regarde.`);
        this.prevenir(executionId);
      }
    }, REGARD_RAPPEL_MS);

    this.peremption.unref();
  }

  /**
   * Publie un evenement. Sans attendre, et sans faire echouer l'execution.
   *
   * Une diffusion perdue ne coute qu'un affichage moins vif : le journal et la
   * progression sont deja en base, et le client les retrouvera a sa prochaine
   * reprise. Faire echouer un run parce que Redis n'a pas repondu serait
   * echanger l'essentiel contre l'accessoire.
   */
  publier(executionId: string, evenement: ExecutionEvent): void {
    this.publieur
      .publish(canalExecution(executionId), JSON.stringify(evenement))
      .catch((erreur: unknown) => {
        log.debug(`Diffusion perdue pour ${executionId} : ${String(erreur)}`);
      });
  }

  /** Quelqu'un regarde-t-il cette execution en ce moment ? */
  estRegardee(executionId: string): boolean {
    return this.regards.has(executionId);
  }

  /** S'abonne aux changements de regard sur une execution. Un seul ecouteur. */
  surRegard(executionId: string, rappel: () => void): void {
    this.ecouteurs.set(executionId, rappel);
  }

  oublierRegard(executionId: string): void {
    this.ecouteurs.delete(executionId);
    this.regards.delete(executionId);
  }

  private prevenir(executionId: string): void {
    this.ecouteurs.get(executionId)?.();
  }

  async fermer(): Promise<void> {
    if (this.peremption) clearInterval(this.peremption);

    await this.abonne.unsubscribe(CANAL_REGARD).catch(() => undefined);
    this.abonne.disconnect();
    this.publieur.disconnect();
  }
}
