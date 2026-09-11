import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CANAL_VIE, executionLifeSchema, type ExecutionLife } from '@flow/contracts';
import type { RequestContext } from '@flow/db';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { contextePour } from './contexte.js';
import { PluginHostService } from './hote.service.js';

/**
 * Le bus des evenements.
 *
 * Un evenement arrive **apres coup** : personne ne l'attend, et une erreur n'y
 * remonte jamais a l'operation qui l'a produit. Un plugin qui casse en traitant
 * une fin d'execution ne fait pas echouer l'execution -- elle est deja
 * terminee, et la faire echouer retroactivement n'aurait aucun sens.
 *
 * C'est l'exact miroir des hooks, et la raison pour laquelle il y a deux
 * mecanismes plutot qu'un : confondre « donne ton avis, je t'attends » et « voila
 * ce qui s'est passe » aurait donne soit des evenements capables de casser
 * l'application, soit des hooks incapables de refuser quoi que ce soit.
 *
 * L'abonnement est **permanent et global**, a la difference du relais temps reel
 * qui suit les lecteurs : un evenement doit arriver meme quand personne ne
 * regarde. C'est precisement le cas d'usage -- une execution nocturne qui
 * echoue.
 */
@Injectable()
export class PluginEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginEventsService.name);
  private readonly abonne: Redis;

  constructor(
    private readonly hote: PluginHostService,
    private readonly db: DatabaseService,
  ) {
    this.abonne = new Redis(loadEnv().REDIS_URL, { lazyConnect: true });
    this.abonne.on('error', (erreur: Error) => {
      this.logger.warn(`Redis (vie des executions) : ${erreur.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.abonne.connect().catch((erreur: unknown) => {
      this.logger.warn(`Abonnement a la vie des executions impossible : ${String(erreur)}`);
    });

    await this.abonne.subscribe(CANAL_VIE).catch((erreur: unknown) => {
      this.logger.warn(`Abonnement a ${CANAL_VIE} impossible : ${String(erreur)}`);
    });

    this.abonne.on('message', (_canal: string, contenu: string) => {
      this.distribuer(contenu);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.abonne.unsubscribe(CANAL_VIE).catch(() => undefined);
    this.abonne.disconnect();
  }

  private distribuer(contenu: string): void {
    let lecture: ReturnType<typeof executionLifeSchema.safeParse>;

    try {
      lecture = executionLifeSchema.safeParse(JSON.parse(contenu));
    } catch {
      this.logger.warn(`Message illisible sur ${CANAL_VIE}.`);

      return;
    }

    if (!lecture.success) {
      this.logger.warn(`Message inattendu sur ${CANAL_VIE}.`);

      return;
    }

    void this.diffuser(lecture.data);
  }

  private async diffuser(vie: ExecutionLife): Promise<void> {
    const nom = vie.phase === 'lancee' ? 'execution.lancee' : 'execution.terminee';
    const abonnes = this.hote.pourEvenement(nom);

    if (abonnes.length === 0) return;

    // Le contexte de l'execution, pas celui d'une requete : l'evenement arrive
    // hors de toute requete HTTP. Le perimetre est l'entite de l'execution,
    // exactement -- c'est deja ce que fait le worker pour ecrire ses journaux.
    const contexte: RequestContext = {
      userId: vie.userId,
      profileId: vie.profileId,
      entityPath: vie.entityPath,
      scope: { subtreePaths: [], exactPaths: [vie.entityPath] },
    };

    for (const plugin of abonnes) {
      const contextePlugin = contextePour(this.db, plugin.manifest.id, plugin.schema, contexte);

      try {
        if (nom === 'execution.lancee') {
          await plugin.instance.events?.['execution.lancee']?.(contextePlugin, {
            executionId: vie.executionId,
            botId: vie.botId,
            entityPath: vie.entityPath,
            userId: vie.userId,
          });
        } else {
          await plugin.instance.events?.['execution.terminee']?.(contextePlugin, {
            executionId: vie.executionId,
            botId: vie.botId,
            entityPath: vie.entityPath,
            userId: vie.userId,
            status: vie.status ?? 'inconnu',
            durationMs: vie.durationMs ?? null,
            message: vie.message ?? null,
          });
        }
      } catch (erreur: unknown) {
        // Journalise, et passe au suivant. Un plugin casse ne prive pas les
        // autres de l'evenement, et ne remonte rien a l'execution.
        this.logger.error(
          `${plugin.manifest.id} sur ${nom} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }
  }
}
