import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities.js';
import { profiles } from './profiles.js';
import { users } from './users.js';

/**
 * Une clef d'API : un second moyen de s'authentifier, pour ce qui n'a pas de
 * navigateur.
 *
 * **Elle porte le meme contexte de travail qu'une session** -- compte, profil,
 * entite, descendance -- et c'est ce qui fait que rien en aval n'a besoin de
 * savoir d'ou vient l'appel : les politiques, les droits et les portees
 * s'appliquent a l'identique.
 *
 * Le secret n'est stocke que sous forme de condensat. Une fuite de la base ne
 * livre donc aucune clef utilisable, et une clef perdue se remplace plutot
 * qu'elle ne se retrouve.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),

    /**
     * Debut de la clef, garde en clair.
     *
     * Il ne permet pas de s'authentifier, et il rend la clef **identifiable** :
     * sans lui, revoquer « celle de la chaine d'integration » demanderait de
     * deviner laquelle, ou de toutes les revoquer.
     */
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),

    /**
     * Le compte au nom duquel la clef agit.
     *
     * C'est son createur, et la regle est volontairement rigide : **une clef ne
     * peut jamais faire plus que la personne qui l'a creee**. Pouvoir choisir un
     * autre compte aurait ouvert une elevation de privileges en un formulaire.
     */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    includeSubEntities: boolean('include_sub_entities').notNull().default(false),

    /**
     * Derniere utilisation.
     *
     * Ecrite au fil de l'eau, et c'est la seule facon de repondre a « cette clef
     * sert-elle encore ? » avant de la revoquer. Sans elle, personne n'ose
     * jamais retirer une clef dont on ne sait plus a quoi elle servait.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Nul vaut « sans expiration ». */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unique : c'est par lui que la resolution cherche, et deux clefs de meme
    // condensat signifieraient une collision de secrets -- impossible en
    // pratique, mais la contrainte le dit plutot que de l'esperer.
    uniqueIndex('api_keys_token_key').on(t.tokenHash),
    index('api_keys_entity_idx').on(t.entityId),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  profile: one(profiles, { fields: [apiKeys.profileId], references: [profiles.id] }),
  entity: one(entities, { fields: [apiKeys.entityId], references: [entities.id] }),
}));
