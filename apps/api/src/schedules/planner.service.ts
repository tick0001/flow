import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { sql } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { BotRegistryService } from '../bots/bot-registry.service.js';
import { prochain } from './cron.js';

/**
 * Cadence du planificateur.
 *
 * Trente secondes : une expression cron a cinq champs ne descend pas sous la
 * minute, et interroger deux fois par minute suffit a ne jamais decaler un
 * declenchement de plus de trente secondes. Passer a la seconde ferait soixante
 * fois plus de requetes pour une precision que personne ne demande -- une
 * execution ouvre un navigateur, ce qui prend plus longtemps que cela.
 */
const PERIODE_MS = 30_000;

/** Planifications declenchees par passe. */
const PAR_PASSE = 50;

/**
 * Le planificateur : il regarde l'heure, et met en file.
 *
 * **Les planifications vivent en base, pas dans la file.** BullMQ sait porter des
 * travaux repetitifs ; elles vivraient alors dans Redis, et un vidage les
 * emporterait toutes. Une planification perdue ne se remarque pas -- rien
 * n'echoue, rien ne s'affiche : le travail cesse simplement d'arriver.
 *
 * **Plusieurs instances d'API peuvent tourner.** Le `FOR UPDATE SKIP LOCKED`
 * arbitre : chaque ligne n'est vue que par une instance, et les autres passent a
 * la suivante au lieu d'attendre. Sans lui, deux instances declencheraient la
 * meme planification a la meme seconde.
 */
@Injectable()
export class SchedulePlannerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulePlannerService.name);
  private minuteur: NodeJS.Timeout | undefined;
  private enCours = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly file: QueueService,
    private readonly registre: BotRegistryService,
  ) {}

  onApplicationBootstrap(): void {
    void this.passe();

    this.minuteur = setInterval(() => {
      void this.passe();
    }, PERIODE_MS);

    this.minuteur.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Une passe. Rend le nombre d'executions creees. Publique pour les tests. */
  async passe(): Promise<number> {
    if (this.enCours) return 0;

    this.enCours = true;

    try {
      return await this.declencher();
    } catch (erreur: unknown) {
      // Une passe qui echoue ne doit pas arreter les suivantes : la cause est le
      // plus souvent une base momentanement absente, que la passe d'apres
      // retrouvera.
      this.logger.error(`Planification interrompue : ${String(erreur)}`);

      return 0;
    } finally {
      this.enCours = false;
    }
  }

  private async declencher(): Promise<number> {
    // Tout dans une transaction, **sauf la mise en file**. La ligne d'execution
    // doit etre commise avant que le travail ne soit publie : dans l'autre
    // ordre, un worker pourrait depiler un travail dont la ligne n'est pas
    // encore visible. C'est la meme regle qu'au lancement a la main, et le
    // filet est le meme -- la reconciliation remet en file ce qui est reste en
    // attente sans travail.
    const creees = await this.db.asOwner(async (tx) => {
      const dues = await tx.execute<{
        id: string;
        name: string;
        botId: string;
        parameters: Record<string, unknown>;
        headed: boolean;
        cron: string;
        timezone: string;
        entityId: number;
        ownerId: number;
        profileId: number;
      }>(sql`
        SELECT id, name, bot_id AS "botId", parameters, headed, cron, timezone,
               entity_id AS "entityId", owner_id AS "ownerId", profile_id AS "profileId"
          FROM schedules
         WHERE is_active
           AND next_run_at IS NOT NULL
           AND next_run_at <= now()
         ORDER BY next_run_at
         LIMIT ${PAR_PASSE}
         FOR UPDATE SKIP LOCKED
      `);

      const lancees: { id: string; botId: string }[] = [];

      for (const planification of dues.rows) {
        const suivant = prochain(planification.cron, planification.timezone);

        // La ligne est repoussee **dans tous les cas**, y compris quand le
        // lancement echoue. Sans cela, une planification dont le bot a ete
        // retire serait reprise a chaque passe, indefiniment, et remplirait les
        // journaux deux fois par minute.
        await tx.execute(sql`
          UPDATE schedules
             SET last_run_at = now(),
                 next_run_at = ${suivant},
                 updated_at = now()
           WHERE id = ${planification.id}::uuid
        `);

        const bot = this.registre.get(planification.botId);

        if (!bot?.loaded) {
          // Dit une fois par declenchement, pas une fois par passe : la ligne
          // ci-dessus a deja repousse l'echeance.
          this.logger.warn(
            `Planification « ${planification.name} » : bot ${planification.botId} indisponible.`,
          );

          continue;
        }

        const [execution] = await tx
          .execute<{ id: string }>(
            sql`
            INSERT INTO executions
              (bot_id, bot_name, bot_version, parameters, headed,
               entity_id, requested_by, profile_id, schedule_id)
            VALUES
              (${bot.manifest.id}, ${bot.manifest.name}, ${bot.manifest.version},
               ${JSON.stringify(planification.parameters)}::jsonb, ${planification.headed},
               ${planification.entityId}, ${planification.ownerId}, ${planification.profileId},
               ${planification.id}::uuid)
            RETURNING id
          `,
          )
          .then((resultat) => resultat.rows);

        if (execution) lancees.push({ id: execution.id, botId: bot.manifest.id });
      }

      return lancees;
    });

    for (const execution of creees) {
      try {
        await this.file.enqueue({ executionId: execution.id, botId: execution.botId });
      } catch (erreur: unknown) {
        // La ligne est en base et restera `queued` : la reconciliation la
        // remettra en file des que Redis repond.
        this.logger.error(`Mise en file impossible pour ${execution.id} : ${String(erreur)}`);
      }
    }

    if (creees.length > 0) {
      this.logger.log(`Planification : ${String(creees.length)} execution(s) lancee(s).`);
    }

    return creees.length;
  }
}
