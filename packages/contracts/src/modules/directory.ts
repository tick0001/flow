import { z } from 'zod';
import { entityRefSchema, profileRefSchema } from './auth.js';

/**
 * Nom d'un groupe d'annuaire.
 *
 * Compare **sans casse** : un annuaire rend tantot `Exploitation`, tantot
 * `exploitation`, selon l'attribut lu et le connecteur qui l'a ecrit. Faire
 * dependre des droits de cette variation-la donnerait une panne qu'aucun journal
 * n'expliquerait -- d'ou une colonne insensible a la casse en base, et une
 * comparaison qui ne l'est pas davantage ici.
 */
export const groupNameSchema = z.string().trim().min(1).max(200);

/** Une regle d'affectation, telle que l'ecran l'affiche. */
export const directoryRuleSchema = z.object({
  id: z.number().int().positive(),
  groupName: z.string(),
  profile: profileRefSchema,
  entity: entityRefSchema,
  isRecursive: z.boolean(),
  createdAt: z.coerce.date(),
});
export type DirectoryRule = z.infer<typeof directoryRuleSchema>;

export const createDirectoryRuleSchema = z.object({
  groupName: groupNameSchema,
  profileId: z.number().int().positive(),
  entityId: z.number().int().positive(),
  /**
   * L'habilitation posee porte-t-elle sur la descendance ?
   *
   * Faux par defaut, comme partout ailleurs : une habilitation qui descend est
   * un choix, et un defaut qui descend se decouvre le jour ou quelqu'un voit une
   * branche qu'il ne devait pas voir.
   */
  isRecursive: z.boolean().default(false),
});
export type CreateDirectoryRule = z.infer<typeof createDirectoryRuleSchema>;

export const updateDirectoryRuleSchema = createDirectoryRuleSchema.partial();
export type UpdateDirectoryRule = z.infer<typeof updateDirectoryRuleSchema>;

/**
 * Ce qu'une connexion d'annuaire a produit, pour l'expliquer a l'ecran.
 *
 * Un compte d'annuaire qui se connecte et n'obtient rien est le cas le plus
 * penible a diagnostiquer : le mot de passe etait bon, l'annuaire a repondu, et
 * pourtant l'application refuse. La reponse est presque toujours qu'aucune regle
 * ne correspond aux groupes rendus -- encore faut-il pouvoir les lire.
 */
export const directoryTraceSchema = z.object({
  username: z.string(),
  groups: z.array(z.string()),
  matched: z.array(z.string()),
  /** Habilitations posees par les regles, apres application. */
  granted: z.number().int().nonnegative(),
});
export type DirectoryTrace = z.infer<typeof directoryTraceSchema>;
