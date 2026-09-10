import { z } from 'zod';
import { localeSchema, rightScopeSchema } from './common.js';

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type Login = z.infer<typeof loginSchema>;

/**
 * Changement de mot de passe.
 *
 * L'ancien est exige meme quand le changement est impose : sans lui, quiconque
 * met la main sur une session ouverte -- un poste laisse sans surveillance --
 * s'approprie le compte definitivement.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(12, 'Douze caracteres au minimum.')
    .max(200)
    .refine((valeur) => valeur.trim().length >= 12, 'Douze caracteres au minimum.'),
});
export type ChangePassword = z.infer<typeof changePasswordSchema>;

/** Entite telle qu'elle apparait dans un selecteur ou un arbre. */
export const entityRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  completeName: z.string(),
  path: z.string(),
  level: z.number().int().nonnegative(),
  parentId: z.number().int().positive().nullable(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const profileRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});
export type ProfileRef = z.infer<typeof profileRefSchema>;

/**
 * Un couple (entite, profil) vers lequel le compte peut basculer.
 *
 * Le perimetre **habilite**, celui qui alimente le selecteur -- a ne pas
 * confondre avec le perimetre de travail, qui est injecte dans le Row-Level
 * Security et se limite a l'entite active.
 */
export const availableContextSchema = z.object({
  entity: entityRefSchema,
  profile: profileRefSchema,
  isRecursive: z.boolean(),
});
export type AvailableContext = z.infer<typeof availableContextSchema>;

/**
 * Etat complet de la session : qui, ou, avec quels droits, et vers quoi basculer.
 *
 * `rights` est servi au client pour qu'il n'affiche pas des boutons qui seront
 * refuses. Ce n'est **pas** un controle d'acces : le serveur revalide chaque
 * action, et l'interface ne fait qu'eviter de proposer l'impossible.
 */
export const sessionContextSchema = z.object({
  user: z.object({
    id: z.number().int().positive(),
    username: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    locale: localeSchema,
    mustChangePassword: z.boolean(),
  }),
  entity: entityRefSchema,
  profile: profileRefSchema,
  includeSubEntities: z.boolean(),
  /** `objet:action` vers la portee accordee. Une clef absente vaut refus. */
  rights: z.record(z.string(), rightScopeSchema),
  available: z.array(availableContextSchema),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

/** Bascule d'entite ou de profil, sans se reconnecter. */
export const switchContextSchema = z.object({
  entityId: z.number().int().positive(),
  profileId: z.number().int().positive(),
  includeSubEntities: z.boolean().default(true),
});
export type SwitchContext = z.infer<typeof switchContextSchema>;
