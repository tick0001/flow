import { relations } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { citext } from '../types.js';
import { entities } from './entities.js';
import { profiles } from './profiles.js';

/**
 * Une regle d'affectation : « ce groupe d'annuaire donne ce profil sur cette
 * entite ».
 *
 * **Elle appartient au coeur, pas au plugin d'annuaire.** Un profil et une
 * entite sont des objets du coeur ; laisser chaque source externe les resoudre a
 * sa facon aurait donne autant de lectures des droits qu'il y a de plugins, et
 * une erreur dans l'un serait une elevation de privileges dans toute
 * l'installation. Le plugin ne rend que des noms de groupes -- des chaines, que
 * n'importe quelle source sait produire : un annuaire, un fournisseur OIDC, un
 * en-tete pose par un portail.
 *
 * Le nom du groupe est insensible a la casse : un annuaire rend tantot
 * `CN=Exploitation`, tantot `cn=exploitation`, et faire dependre les droits de
 * cette variation-la donnerait une panne qu'aucun journal n'expliquerait.
 */
export const directoryRules = pgTable(
  'directory_rules',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    /**
     * Nom du groupe, tel que la source le rend.
     *
     * Un nom, et non un DN complet : le meme groupe se nomme differemment selon
     * la branche de l'annuaire ou on le lit, et c'est le plugin qui normalise.
     */
    groupName: citext('group_name').notNull(),

    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),

    /** L'habilitation posee porte-t-elle aussi sur la descendance ? */
    isRecursive: boolean('is_recursive').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Deux regles identiques ne diraient rien de plus et poseraient deux fois la
    // meme habilitation.
    uniqueIndex('directory_rules_unique').on(table.groupName, table.profileId, table.entityId),
    index('directory_rules_group_idx').on(table.groupName),
  ],
);

export const directoryRulesRelations = relations(directoryRules, ({ one }) => ({
  profile: one(profiles, { fields: [directoryRules.profileId], references: [profiles.id] }),
  entity: one(entities, { fields: [directoryRules.entityId], references: [entities.id] }),
}));
