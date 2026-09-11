import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  CANAL_REGARD,
  REGARD_RAPPEL_MS,
  canalExecution,
  executionEventSchema,
  type ExecutionEvent,
  type ExecutionStatus,
} from '@flow/contracts';
import { loadEnv } from '../config/env.js';

type Ecouteur = (evenement: ExecutionEvent) => void;

/**
 * Le relais entre Redis et les lecteurs d'une execution.
 *
 * **L'abonnement suit les lecteurs.** La premiere personne qui ouvre une
 * execution ouvre l'abonnement Redis, la derniere qui s'en va le ferme. Un
 * abonnement global aurait ete plus court a ecrire et aurait fait recevoir a
 * chaque instance d'API tout ce que produisent toutes les executions de
 * l'installation -- images du screencast comprises -- pour en jeter presque
 * tout.
 *
 * Le service tient aussi le **compte des regards**, et le publie aux workers :
 * c'est ce qui decide qu'une vue en direct s'ouvre ou se ferme. Le journal et la
 * progression, eux, sont diffuses de toute facon -- ils sont minuscules et deja
 * ecrits en base.
 */
@Injectable()
export class ExecutionRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutionRelayService.name);
  private readonly abonne: Redis;
  private readonly publieur: Redis;
  private readonly lecteurs = new Map<string, Set<Ecouteur>>();
  private rappel: NodeJS.Timeout | undefined;

  constructor() {
    const url = loadEnv().REDIS_URL;

    this.abonne = new Redis(url);
    this.publieur = new Redis(url);

    for (const [nom, client] of [
      ['abonnement', this.abonne],
      ['regards', this.publieur],
    ] as const) {
      client.on('error', (erreur: Error) => {
        this.logger.warn(`Redis (${nom}) : ${erreur.message}`);
      });
    }

    this.abonne.on('message', (canal: string, contenu: string) => {
      this.distribuer(canal, contenu);
    });

    // Le regard se **repete** tant qu'on regarde. Un worker ne saurait pas
    // autrement qu'une instance d'API est morte pendant qu'un lecteur regardait,
    // et continuerait d'encoder des images pour un navigateur qui n'est plus la.
    this.rappel = setInterval(() => {
      for (const executionId of this.lecteurs.keys()) {
        this.annoncerLeRegard(executionId);
      }
    }, REGARD_RAPPEL_MS);

    this.rappel.unref();
  }

  /**
   * Branche un lecteur sur une execution. Rend de quoi se debrancher.
   *
   * L'appelant **doit** appeler la fonction rendue : sans cela l'abonnement
   * Redis survivrait a la fermeture de l'onglet, et les workers continueraient
   * de croire qu'on regarde.
   */
  async abonner(executionId: string, ecouteur: Ecouteur): Promise<() => void> {
    let ensemble = this.lecteurs.get(executionId);

    if (!ensemble) {
      ensemble = new Set();
      this.lecteurs.set(executionId, ensemble);
      await this.abonne.subscribe(canalExecution(executionId));
    }

    ensemble.add(ecouteur);
    this.annoncerLeRegard(executionId);

    let debranche = false;

    return () => {
      // Un debranchement peut arriver deux fois -- flux ferme puis composant
      // demonte -- et le second ne doit pas defaire l'abonnement d'un autre
      // lecteur arrive entre-temps.
      if (debranche) return;

      debranche = true;
      ensemble.delete(ecouteur);

      if (ensemble.size > 0) {
        this.annoncerLeRegard(executionId);

        return;
      }

      this.lecteurs.delete(executionId);
      void this.abonne.unsubscribe(canalExecution(executionId)).catch(() => undefined);
      this.annoncerLeRegard(executionId);
    };
  }

  /**
   * Diffuse un changement decide par l'API et non par un worker.
   *
   * Un seul cas aujourd'hui : l'interruption demandee sur une execution en
   * cours. Elle ne change pas l'etat -- le worker l'appliquera entre deux
   * etapes -- mais elle change ce que les autres lecteurs doivent voir. Sans
   * cette diffusion, deux navigateurs ouverts sur la meme execution
   * n'afficheraient pas la meme chose, ce qui est precisement ce que ce jalon
   * promet.
   */
  publierChangement(executionId: string, status: ExecutionStatus): void {
    const evenement: ExecutionEvent = {
      kind: 'status',
      payload: { executionId, status },
    };

    this.publieur
      .publish(canalExecution(executionId), JSON.stringify(evenement))
      .catch((erreur: unknown) => {
        this.logger.debug(`Diffusion perdue pour ${executionId} : ${String(erreur)}`);
      });
  }

  private distribuer(canal: string, contenu: string): void {
    const executionId = canal.slice(canalExecution('').length);
    const ensemble = this.lecteurs.get(executionId);

    if (!ensemble || ensemble.size === 0) return;

    let evenement: ExecutionEvent;

    try {
      evenement = executionEventSchema.parse(JSON.parse(contenu));
    } catch {
      // Un message illisible vient d'un worker d'une autre version : on le jette
      // plutot que de faire tomber le flux de tout le monde.
      this.logger.warn(`Evenement illisible sur ${canal}.`);

      return;
    }

    for (const ecouteur of ensemble) {
      try {
        ecouteur(evenement);
      } catch (erreur: unknown) {
        // Un lecteur dont le flux s'est ferme sous lui ne doit pas priver les
        // autres du meme evenement.
        this.logger.debug(`Lecteur en erreur sur ${executionId} : ${String(erreur)}`);
      }
    }
  }

  private annoncerLeRegard(executionId: string): void {
    const watchers = this.lecteurs.get(executionId)?.size ?? 0;

    this.publieur
      .publish(CANAL_REGARD, JSON.stringify({ executionId, watchers }))
      .catch((erreur: unknown) => {
        this.logger.debug(`Annonce de regard perdue : ${String(erreur)}`);
      });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.rappel) clearInterval(this.rappel);

    // On annonce le depart avant de partir : sinon les workers attendraient la
    // peremption du signal pour cesser d'encoder des images.
    for (const executionId of this.lecteurs.keys()) {
      this.publieur
        .publish(CANAL_REGARD, JSON.stringify({ executionId, watchers: 0 }))
        .catch(() => undefined);
    }

    this.lecteurs.clear();
    this.abonne.disconnect();
    this.publieur.disconnect();

    await Promise.resolve();
  }
}
