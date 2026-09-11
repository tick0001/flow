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

/**
 * Etat d'une execution.
 *
 * Six valeurs, et `abandoned` est distingue de `cancelled` : la premiere dit
 * qu'aucun worker ne detenait plus l'execution -- processus tue, machine
 * redemarree --, la seconde qu'une personne l'a interrompue. Les confondre
 * effacerait la seule trace d'une panne d'infrastructure.
 *
 * Un enumere PostgreSQL et non un texte libre : c'est la base qui refuse un etat
 * inconnu, y compris venu d'une requete brute ou d'un plugin.
 */
export const executionStatusEnum = pgEnum('execution_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'abandoned',
]);

/**
 * Gravite d'une ligne de journal, et rien d'autre : « filtrer a partir de
 * l'avertissement » doit avoir un sens. Pas de niveau `success`, qui n'est pas
 * une gravite mais une intention d'affichage -- la reussite se lit sur l'etat de
 * l'execution.
 */
export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warning', 'error']);

/**
 * Nature d'une piece produite par une execution.
 *
 * Trois valeurs, et la distinction sert a l'affichage comme a la retention : une
 * capture s'affiche, une trace se telecharge et s'ouvre dans l'outil de
 * Playwright, un fichier de sortie appartient au bot et le coeur n'en sait rien.
 */
export const artifactKindEnum = pgEnum('artifact_kind', ['screenshot', 'trace', 'output']);
