import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities.js';
import { profiles } from './profiles.js';
import { users } from './users.js';
import { executionStatusEnum, logLevelEnum } from './enums.js';

/**
 * Une execution de bot : la trace, et la source de verite de son etat.
 *
 * **La base porte l'etat, la file ne porte que l'intention de faire.** Un vidage
 * de Redis ne perd donc aucun historique, et un redemarrage de l'API ou du
 * worker ne perd pas une execution en cours -- elle se retrouve par cette
 * table, jamais par ce qui reste dans la file. C'est l'ecart le plus net avec
 * l'outil remplace, ou une execution etait un `Task.Run` dans le processus web,
 * disparue avec lui.
 *
 * Le sens de lecture des colonnes suit le cycle de vie : ce que l'on a demande,
 * qui l'a demande, qui l'execute, ou cela en est, ce qui en est sorti.
 */
export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Le bot, recopie plutot que reference.
     *
     * Il n'y a pas de table des bots : ils vivent sur le disque et le registre
     * les relit. Recopier l'identifiant, le nom et la version fige ce qui a
     * reellement tourne -- un bot se met a jour, se renomme, se retire, et une
     * trace qui irait chercher son nom au registre afficherait alors le nom
     * d'autre chose, ou rien.
     */
    botId: text('bot_id').notNull(),
    botName: text('bot_name').notNull(),
    botVersion: text('bot_version').notNull(),

    /** Parametres valides, defauts appliques : ce qui a reellement ete passe. */
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),

    /** Navigateur visible : un mode de mise au point, jamais le defaut. */
    headed: boolean('headed').notNull().default(false),

    status: executionStatusEnum('status').notNull().default('queued'),

    /**
     * Entite de rattachement : celle qui etait active au lancement.
     *
     * C'est elle qui decide de la visibilite de la trace, par la politique de
     * Row-Level Security. Pas de chemin denormalise ici : la politique joint
     * `entities`, dont la lecture par identifiant est un acces d'index sur une
     * table minuscule. Une copie du chemin aurait ete plus rapide et fausse des
     * le premier deplacement d'entite, puisque rien ne l'aurait propagee.
     */
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),

    /** Le compte qui a lance. C'est lui que la portee `own` d'un droit designe. */
    requestedBy: bigint('requested_by', { mode: 'number' })
      .notNull()
      .references(() => users.id),

    /**
     * Profil actif au lancement.
     *
     * Conserve parce que le worker en a besoin : il reconstitue le contexte de la
     * requete qui n'existe plus pour ecrire les journaux sous le meme
     * cloisonnement que le reste de l'application.
     */
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),

    /**
     * Identifiant du worker qui detient l'execution.
     *
     * Avec `heartbeat_at`, c'est ce qui permet de distinguer une execution
     * vivante d'une execution orpheline -- un worker tue ne vient pas dire qu'il
     * est parti.
     */
    workerId: text('worker_id'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),

    /**
     * Interruption demandee.
     *
     * Ecrite en base **avant** d'etre publiee : la diffusion ne fait que hater
     * les choses. Un worker qui redemarre relit la colonne, et un worker qui
     * n'ecoutait pas au bon moment la voit a son battement suivant. Une
     * annulation qui n'aurait vecu que dans un canal de diffusion serait perdue
     * par le premier redemarrage.
     */
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),

    /** Derniere etape annoncee par le bot. Le pourcentage reste facultatif. */
    progressStep: text('progress_step'),
    progressPercent: integer('progress_percent'),

    /** Phrase de conclusion, ou message d'echec. */
    message: text('message'),
    /** Donnee metier rendue par le bot. Le coeur ne sait rien de sa forme. */
    output: jsonb('output').$type<Record<string, unknown>>(),
    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    // L'index des listes. `created_at` descendant parce que c'est l'ordre de
    // lecture, et l'identifiant en second pour que la pagination par curseur
    // reste deterministe quand deux executions partagent la milliseconde.
    index('executions_entity_recent_idx').on(t.entityId, t.createdAt.desc(), t.id.desc()),
    index('executions_bot_idx').on(t.botId, t.createdAt.desc()),
    index('executions_requested_by_idx').on(t.requestedBy, t.createdAt.desc()),
    // Le balayage des orphelines et la reconciliation de la file interrogent les
    // etats non terminaux, qui sont une poignee de lignes dans une table qui
    // grossit sans fin. L'index porte donc sur l'etat seul.
    index('executions_status_idx').on(t.status),
  ],
);

/**
 * Journal d'une execution, persiste au fil de l'eau.
 *
 * Ecrit pendant l'execution et non accumule en memoire jusqu'a la fin : une
 * execution d'une heure interrompue par un incident laissait, dans l'outil
 * remplace, un historique vide -- c'est-a-dire rien pour comprendre l'incident.
 *
 * Le rang fait partie de la clef primaire. L'horodatage ne suffit pas a ordonner
 * -- un bot qui journalise en boucle produit plusieurs lignes dans la meme
 * milliseconde -- et le rang sert aussi de point de reprise : le client redemande
 * « ce qui suit le rang n » au lieu de tout recharger.
 *
 * Il est attribue par le worker, qui est a tout instant le seul ecrivain d'une
 * execution donnee : une sequence PostgreSQL aurait ete globale a la table, donc
 * trouee et sans signification a l'interieur d'une execution.
 */
export const executionLogs = pgTable(
  'execution_logs',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    level: logLevelEnum('level').notNull(),
    message: text('message').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.seq] }),
    // La purge (jalon J5) supprime par date, sur toutes les executions a la
    // fois : sans cet index elle balaierait la plus grosse table du schema.
    index('execution_logs_at_idx').on(t.at),
  ],
);

export const executionsRelations = relations(executions, ({ one, many }) => ({
  entity: one(entities, { fields: [executions.entityId], references: [entities.id] }),
  requester: one(users, { fields: [executions.requestedBy], references: [users.id] }),
  profile: one(profiles, { fields: [executions.profileId], references: [profiles.id] }),
  logs: many(executionLogs),
}));

export const executionLogsRelations = relations(executionLogs, ({ one }) => ({
  execution: one(executions, {
    fields: [executionLogs.executionId],
    references: [executions.id],
  }),
}));
