import { relations } from 'drizzle-orm';
import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';
import { profiles } from './profiles.js';
import { users } from './users.js';

/**
 * Une planification : un bot, une expression cron, un fuseau.
 *
 * **L'etat vit en base, comme pour les executions**, et non dans la file. BullMQ
 * sait porter des travaux repetitifs ; ses planifications vivraient alors dans
 * Redis, et un vidage les emporterait toutes. Une planification manquee ne se
 * rattrape pas toute seule : c'est precisement ce qu'on ne veut pas perdre.
 *
 * Le planificateur de l'API interroge donc cette table, et n'utilise la file que
 * pour ce qu'elle fait bien -- transporter l'intention d'executer.
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),

    /**
     * Le bot vise, par son identifiant.
     *
     * Pas de cle etrangere : il n'y a pas de table des bots, ils vivent sur le
     * disque. Une planification dont le bot a ete retire reste donc visible, et
     * echoue en le disant -- ce qui est mieux que de disparaitre sans explication
     * le jour ou quelqu'un deplace un dossier.
     */
    botId: text('bot_id').notNull(),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    headed: boolean('headed').notNull().default(false),

    /** Expression cron a cinq champs. Analysee par le serveur, jamais ici. */
    cron: text('cron').notNull(),

    /**
     * Fuseau IANA, obligatoire.
     *
     * « Neuf heures » ne veut rien dire sans lui : le serveur tourne peut-etre en
     * UTC, l'organisation est ailleurs, et l'heure d'ete decale les deux fois par
     * an. Le stocker resout aussi le cas d'une installation qui sert plusieurs
     * pays depuis la meme base.
     */
    timezone: text('timezone').notNull(),

    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    /**
     * Le compte au nom duquel les executions sont creees, et son profil.
     *
     * Une planification agit comme quelqu'un : c'est ce qui donne un sens a la
     * portee `own` d'un droit sur les executions qu'elle produit, et ce qui
     * permet au worker de reconstituer un contexte de travail.
     */
    ownerId: bigint('owner_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),

    isActive: boolean('is_active').notNull().default(true),

    /**
     * Prochain declenchement, calcule a l'ecriture et apres chaque tir.
     *
     * Stocke plutot que calcule a la volee : c'est la colonne sur laquelle le
     * planificateur interroge, et une expression cron analysee a chaque passe
     * pour chaque planification couterait bien plus qu'un index.
     *
     * Nul quand la planification est inactive : rien a declencher, rien a
     * calculer.
     */
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // L'index du planificateur : il ne cherche que ce qui est actif et du. Un
    // index partiel serait plus petit encore, mais Drizzle ne l'exprime pas, et
    // le gain sur une table de quelques centaines de lignes serait theorique.
    index('schedules_prochaine_idx').on(t.isActive, t.nextRunAt),
    index('schedules_entity_idx').on(t.entityId),
  ],
);

export const schedulesRelations = relations(schedules, ({ one }) => ({
  entity: one(entities, { fields: [schedules.entityId], references: [entities.id] }),
  owner: one(users, { fields: [schedules.ownerId], references: [users.id] }),
  profile: one(profiles, { fields: [schedules.profileId], references: [profiles.id] }),
}));
