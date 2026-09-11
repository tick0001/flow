import { z } from 'zod';
import { entityRefSchema, profileRefSchema } from './auth.js';
import { localeSchema, rightScopeSchema } from './common.js';

/**
 * Un identifiant de compte.
 *
 * Meme forme que celle attendue par un annuaire : ni espace ni majuscule
 * imposee, puisque la colonne est insensible a la casse. Refuser l'espace evite
 * qu'« a. dupont » et « a.dupont » designent deux comptes qu'on croira le meme.
 */
export const usernameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[^\s]+$/, 'Aucun espace dans un identifiant.');

/**
 * Mot de passe initial pose par un administrateur.
 *
 * Douze caracteres, comme pour un changement volontaire. Il est de toute facon
 * transitoire : le compte cree porte l'obligation de le changer.
 */
export const initialPasswordSchema = z.string().min(12, 'Douze caracteres au minimum.').max(200);

/** Habilitation telle qu'elle est servie et posee : (profil, entite, recursif). */
export const authorizationSchema = z.object({
  entity: entityRefSchema,
  profile: profileRefSchema,
  isRecursive: z.boolean(),
  /** Posee par une regle d'annuaire : ni modifiable ni supprimable a la main. */
  isDynamic: z.boolean(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

export const grantAuthorizationSchema = z.object({
  entityId: z.number().int().positive(),
  profileId: z.number().int().positive(),
  isRecursive: z.boolean().default(false),
});
export type GrantAuthorization = z.infer<typeof grantAuthorizationSchema>;

/** Compte, tel qu'il apparait dans la liste d'administration. */
export const userSummarySchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  locale: localeSchema.nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  /** `ldap` : l'authentification est deleguee, il n'y a pas de mot de passe local. */
  authSource: z.enum(['local', 'ldap']),
  lastLoginAt: z.coerce.date().nullable(),
  /** Habilitations **visibles depuis le perimetre courant**, pas forcement toutes. */
  authorizations: z.array(authorizationSchema),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

/**
 * Creation d'un compte.
 *
 * L'habilitation initiale est **obligatoire**, et ce n'est pas une commodite :
 * un compte sans habilitation n'est visible de personne -- pas meme de qui vient
 * de le creer, puisque la liste passe par une jointure sur les habilitations. Il
 * faudrait alors du SQL pour le rattraper. Exiger l'habilitation des la creation
 * ferme ce cas.
 */
export const createUserSchema = z.object({
  username: usernameSchema,
  password: initialPasswordSchema,
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  email: z.email().max(200).nullable().optional(),
  locale: localeSchema.nullable().optional(),
  authorization: grantAuthorizationSchema,
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  email: z.email().max(200).nullable().optional(),
  locale: localeSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUser = z.infer<typeof updateUserSchema>;

/** Reinitialisation par un administrateur : le compte devra le changer. */
export const resetPasswordSchema = z.object({ password: initialPasswordSchema });
export type ResetPassword = z.infer<typeof resetPasswordSchema>;

// --- Profils -----------------------------------------------------------------

export const profileRightSchema = z.object({
  object: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
  scope: rightScopeSchema,
});
export type ProfileRight = z.infer<typeof profileRightSchema>;

export const profileDetailSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  comment: z.string().nullable(),
  isDefault: z.boolean(),
  rights: z.array(profileRightSchema),
  /** Nombre d'habilitations qui s'appuient dessus, dans le perimetre courant. */
  usageCount: z.number().int().nonnegative(),
});
export type ProfileDetail = z.infer<typeof profileDetailSchema>;

export const upsertProfileSchema = z.object({
  name: z.string().min(1).max(120),
  comment: z.string().max(1000).nullable().optional(),
  rights: z.array(profileRightSchema).max(500),
});
export type UpsertProfile = z.infer<typeof upsertProfileSchema>;

/**
 * Catalogue des droits declares par l'application.
 *
 * L'interface dessine sa matrice a partir de ce catalogue plutot que d'une liste
 * ecrite en dur cote client : un objet ajoute au coeur -- ou par un plugin --
 * apparait alors sans que rien ne soit reconstruit, et une action retiree cesse
 * d'etre proposee au lieu de rester cochable sans effet.
 *
 * `scopes` liste les portees qui ont un sens pour ce couple : proposer `own` sur
 * la lecture d'une entite n'en aurait aucun, une entite n'ayant pas d'auteur.
 */
export const rightDefinitionSchema = z.object({
  object: z.string(),
  action: z.string(),
  /** Clef de traduction du libelle, resolue a l'affichage. */
  labelKey: z.string(),

  /**
   * Libelle deja traduit, quand aucune clef ne peut le porter.
   *
   * Les droits du coeur ont une clef : leurs libelles vivent dans les
   * dictionnaires, compiles dans le paquet de l'interface. Un plugin ne peut
   * rien y ajouter -- il arrive apres la construction. Il porte donc ses
   * libelles avec lui, et l'interface les prefere a la clef quand ils sont la.
   */
  label: z.record(localeSchema, z.string()).optional(),

  /** Libelle du groupe -- le nom du plugin -- pour les memes raisons. */
  groupLabel: z.record(localeSchema, z.string()).optional(),

  scopes: z.array(rightScopeSchema).min(1),
});
export type RightDefinition = z.infer<typeof rightDefinitionSchema>;

export const rightsCatalogSchema = z.array(rightDefinitionSchema);
export type RightsCatalog = z.infer<typeof rightsCatalogSchema>;
