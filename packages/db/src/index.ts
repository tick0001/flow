/**
 * Couche de donnees : schema Drizzle du coeur, connexion, contexte de requete.
 *
 * Les tables et les operateurs de Drizzle sont reexportes ici pour que les
 * consommateurs n'importent qu'un seul paquet. Sans cela, chaque service
 * dependrait a la fois de `@flow/db` et de `drizzle-orm`, et rien ne garantirait
 * que les deux versions concordent.
 */
export * from './client.js';
export * from './context.js';
export * from './types.js';
export * from './schema/index.js';

export type { SQL } from 'drizzle-orm';

export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
