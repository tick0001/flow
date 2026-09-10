import { pgEnum } from 'drizzle-orm/pg-core';

/** Source d'authentification d'un compte. */
export const authSourceEnum = pgEnum('auth_source', ['local', 'ldap']);

/**
 * Portee d'un droit, toujours combinee a l'entite active.
 *
 * Pas de portee `group` : Flow& n'a pas de groupes, et en declarer une que rien
 * ne sait resoudre reviendrait a offrir un reglage sans effet. Elle s'ajoutera
 * le jour ou les groupes existeront -- `ALTER TYPE ... ADD VALUE` suffit.
 */
export const rightScopeEnum = pgEnum('right_scope', ['own', 'entity', 'recursive', 'all']);
