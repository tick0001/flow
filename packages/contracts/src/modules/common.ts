import { z } from 'zod';

/** Langues prises en charge par l'interface et les courriels. */
export const localeSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'fr';

/**
 * Reponse du point de sante de l'API.
 *
 * `checks` dit **laquelle** des dependances manque. Un `degraded` sans detail
 * oblige a ouvrir les journaux du conteneur pour savoir s'il faut regarder
 * PostgreSQL, Redis ou les workers -- ce qui est precisement le moment ou l'on
 * n'a pas le temps.
 *
 * `workers` compte les workers vivants, et non un booleen : zero worker est une
 * panne complete, un worker sur quatre est une degradation qu'on veut voir
 * avant que la file ne s'allonge.
 */
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: z.boolean(),
    queues: z.boolean(),
    workers: z.number().int().nonnegative(),
  }),
});
export type Health = z.infer<typeof healthSchema>;

/**
 * Portee d'un droit, toujours combinee a l'entite active.
 * Voir docs/03-entites-droits-securite.md.
 */
export const rightScopeSchema = z.enum(['own', 'group', 'entity', 'recursive', 'all']);
export type RightScope = z.infer<typeof rightScopeSchema>;

/**
 * Booleen venant d'une chaine de requete.
 *
 * `z.coerce.boolean()` ne convient pas : il applique la veracite JavaScript, ou
 * la chaine `"false"` vaut vrai. Un filtre qui s'active quand on le desactive
 * est le genre de bug qu'on met longtemps a croire.
 */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');

/**
 * Pagination par curseur, sur toutes les listes.
 *
 * Jamais d'`OFFSET`. Une installation qui tourne accumule des exécutions sans
 * jamais en supprimer d'elle-meme, et c'est la table qui grossit le plus vite :
 * l'`OFFSET` s'y effondrerait le jour ou l'on voudrait remonter loin dans
 * l'historique, c'est-a-dire le jour d'un incident.
 */
export const cursorQuerySchema = z.object({
  /** Curseur opaque rendu par la page precedente. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/**
 * Enveloppe d'une page de resultats.
 *
 * `nextCursor` a `null` signifie « fin de liste » et non « je ne sais pas » :
 * l'appelant n'a pas a deviner s'il doit redemander pour en etre sur.
 */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
