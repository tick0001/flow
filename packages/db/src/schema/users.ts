import { relations } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { citext } from '../types.js';
import { authSourceEnum } from './enums.js';
import { entities } from './entities.js';

export const users = pgTable(
  'users',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    username: citext('username').notNull(),
    email: citext('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    /** Nul pour un compte d'annuaire : l'authentification est deleguee. */
    passwordHash: text('password_hash'),
    authSource: authSourceEnum('auth_source').notNull().default('local'),
    ldapDn: text('ldap_dn'),
    locale: text('locale'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Impose un changement de mot de passe a la prochaine connexion.
     *
     * Le compte d'amorcage le porte : une installation dont l'administrateur
     * garde le mot de passe initial est ouverte a quiconque a lu la
     * documentation.
     */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Entite proposee a la connexion, parmi celles ou le compte est habilite. */
    defaultEntityId: bigint('default_entity_id', { mode: 'number' }).references(() => entities.id),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_username_key').on(t.username), index('users_email_idx').on(t.email)],
);

export const usersRelations = relations(users, ({ one }) => ({
  defaultEntity: one(entities, {
    fields: [users.defaultEntityId],
    references: [entities.id],
  }),
}));
