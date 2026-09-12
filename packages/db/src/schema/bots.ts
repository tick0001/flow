import { relations } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';
import { profiles } from './profiles.js';

/**
 * Une regle de mise a disposition : « ce bot est ouvert sur cette entite, pour
 * ce profil ».
 *
 * **Un bot n'est pas une ligne en base.** C'est un dossier sur le disque, relu
 * au demarrage : il n'a ni entite, ni proprietaire, ni identifiant interne. Cette
 * table ne le decrit donc pas, elle dit seulement ou et pour qui il est propose.
 * D'ou un `bot_id` en texte libre, sans cle etrangere : une regle peut viser un
 * bot qui n'est pas encore depose -- on prepare l'ouverture avant la livraison --
 * et survivre a son retrait temporaire du dossier.
 *
 * **Deux axes, parce que ce sont deux questions distinctes.** L'entite repond a
 * « ou ce bot a-t-il le droit de tourner » : un bot qui vide une boite aux
 * lettres RH n'a rien a faire dans la branche logistique. Le profil repond a
 * « qui, la-bas, peut le lancer » : l'operateur du site, oui ; le lecteur, non.
 * Les fondre en un seul axe aurait force a repeter l'arbre des entites dans
 * chaque profil, ou l'inverse.
 *
 * `profile_id` a nul signifie **tous les profils**. Sans cette valeur, ouvrir un
 * bot a une branche demandait autant de lignes que l'installation compte de
 * profils, et en oublier un donnait une panne qui ne se voyait que du poste de
 * la personne concernee.
 *
 * **L'absence de regle vaut refus**, comme partout ailleurs dans le modele de
 * droits. Un bot depose n'est donc visible de personne tant qu'on ne l'a pas
 * ouvert -- ce qui est le comportement voulu pour du code que quelqu'un vient de
 * poser sur le serveur. Les porteurs de `bot:manage` le voient malgre tout, avec
 * la mention qu'il n'est ouvert nulle part : sans cela, le refus par defaut
 * serait indiscernable d'une panne du registre.
 */
export const botRules = pgTable(
  'bot_rules',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),

    /** Identifiant du manifeste, tel que le registre le lit. */
    botId: text('bot_id').notNull(),

    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),

    /**
     * La regle porte-t-elle aussi sur la descendance de l'entite ?
     *
     * Vraie par defaut : ouvrir un bot a une branche est le cas courant, et
     * l'ouvrir a une entite seule au milieu d'un arbre est l'exception.
     */
    isRecursive: boolean('is_recursive').notNull().default(true),

    /** Nul : tous les profils de cette entite. */
    profileId: bigint('profile_id', { mode: 'number' }).references(() => profiles.id, {
      onDelete: 'cascade',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Deux regles identiques ne diraient rien de plus.
    //
    // **PostgreSQL tient deux NULL pour differents** : cet index ne couvre donc
    // pas les regles « tous profils », qu'il laisserait se dupliquer. Un index
    // partiel s'en charge, pose a la main dans la migration du cloisonnement --
    // `NULLS NOT DISTINCT` existe depuis PostgreSQL 15, mais pas dans la version
    // de Drizzle utilisee ici.
    uniqueIndex('bot_rules_unique').on(table.botId, table.entityId, table.profileId),
    index('bot_rules_bot_idx').on(table.botId),
    index('bot_rules_entity_idx').on(table.entityId),
  ],
);

export const botRulesRelations = relations(botRules, ({ one }) => ({
  entity: one(entities, { fields: [botRules.entityId], references: [entities.id] }),
  profile: one(profiles, { fields: [botRules.profileId], references: [profiles.id] }),
}));
