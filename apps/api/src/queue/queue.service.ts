import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CANAL_ANNULATION, EXECUTION_QUEUE, type ExecutionJob } from '@flow/contracts';
import { loadEnv } from '../config/env.js';

/**
 * La file d'executions, vue depuis l'API.
 *
 * L'API ne lance jamais un navigateur : elle ecrit une trace en base, publie une
 * intention de faire, et rend la main. Tout ce que ce service sait faire tient
 * dans cette phrase -- plus l'interruption, qui est une diffusion et non une
 * mise en file.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connexion: Redis;
  private readonly diffuseur: Redis;
  private readonly file: Queue<ExecutionJob>;

  constructor() {
    const url = loadEnv().REDIS_URL;

    // Deux connexions. BullMQ gere la sienne -- il y execute des scripts et des
    // commandes qu'il enchaine -- et publier une annulation dessus melerait deux
    // usages sur un canal que la bibliotheque considere comme le sien. Le cout
    // d'une connexion Redis de plus est nul devant le diagnostic d'une
    // interference entre les deux.
    this.connexion = new Redis(url);
    this.diffuseur = new Redis(url);

    for (const [nom, client] of [
      ['file', this.connexion],
      ['diffusion', this.diffuseur],
    ] as const) {
      // Sans ce gestionnaire, une erreur de connexion ioredis devient une
      // exception non interceptee, qui arrete le processus : une coupure Redis
      // passagere tuerait l'API alors qu'elle sait servir sans la file.
      client.on('error', (erreur: Error) => {
        this.logger.warn(`Redis (${nom}) : ${erreur.message}`);
      });
    }

    this.file = new Queue<ExecutionJob>(EXECUTION_QUEUE, { connection: this.connexion });
  }

  /**
   * Met une execution en file.
   *
   * `jobId` est l'identifiant de l'execution, et c'est ce qui rend l'operation
   * **idempotente** : remettre en file une execution deja en file ne cree pas un
   * doublon. C'est ce sur quoi repose la reconciliation -- la base est la verite,
   * la file en est un reflet qu'on peut reconstruire sans risque.
   *
   * `attempts: 1` : **aucune reprise automatique**. Un bot n'est pas idempotent,
   * il remplit des formulaires et clique sur des boutons ; rejouer un run qui a
   * echoue a mi-chemin refait ce qui avait deja abouti. La reprise est une
   * decision humaine, et elle a un ecran.
   */
  async enqueue(job: ExecutionJob): Promise<void> {
    await this.file.add('executer', job, {
      jobId: job.executionId,
      attempts: 1,
      // L'historique vit en base : garder les travaux termines dans Redis ferait
      // grossir sans fin une copie moins riche de ce que la base porte deja.
      // Quelques centaines suffisent a lire une file en cours de journee.
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    });
  }

  /** Retire un travail encore en attente. Faux s'il n'y etait plus. */
  async remove(executionId: string): Promise<boolean> {
    const travail = await this.file.getJob(executionId);

    if (!travail) return false;

    try {
      await travail.remove();

      return true;
    } catch {
      // `remove` refuse un travail deja pris par un worker. Ce n'est pas une
      // panne : c'est la course normale entre une annulation et un demarrage, et
      // la diffusion prend le relais.
      return false;
    }
  }

  /** Le travail est-il encore connu de la file ? Interroge par la reconciliation. */
  async hasJob(executionId: string): Promise<boolean> {
    return (await this.file.getJob(executionId)) !== undefined;
  }

  /**
   * Diffuse une demande d'interruption.
   *
   * L'intention est **deja ecrite en base** quand ceci est appele : la diffusion
   * ne fait que hater les choses. Un worker qui n'ecoutait pas au bon moment voit
   * la demande a son battement suivant, et un worker qui redemarre la relit.
   * Faire porter l'annulation par la seule diffusion l'aurait rendue perdable.
   */
  async publishCancel(executionId: string): Promise<void> {
    await this.diffuseur.publish(CANAL_ANNULATION, JSON.stringify({ executionId }));
  }

  /**
   * Etat de la file, pour la sonde de sante.
   *
   * Le nombre de workers compte, et non un booleen : zero worker est une panne
   * complete -- les executions s'empilent sans que rien ne les prenne -- alors
   * qu'un worker sur quatre est une degradation qu'on veut voir avant que la
   * file ne s'allonge.
   */
  async state(): Promise<{ reachable: boolean; workers: number }> {
    try {
      const workers = await this.file.getWorkersCount();

      return { reachable: true, workers };
    } catch (erreur: unknown) {
      this.logger.warn(`File injoignable : ${String(erreur)}`);

      return { reachable: false, workers: 0 };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.file.close();
    this.diffuseur.disconnect();
  }
}
