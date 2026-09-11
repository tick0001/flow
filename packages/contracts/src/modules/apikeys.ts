import { z } from 'zod';

/**
 * Une clef d'API, telle qu'on la relit.
 *
 * **Le secret n'y figure pas.** Il n'est montre qu'une fois, a la creation, et
 * le serveur n'en garde qu'un condensat : une clef perdue se remplace, elle ne
 * se retrouve pas. C'est la seule facon qu'une fuite de la base ne livre pas les
 * clefs -- et c'est ce que font tous les outils qui prennent le sujet au serieux.
 *
 * Le prefixe est conserve en clair pour que la clef reste **identifiable** : sans
 * lui, revoquer « celle de la chaine d'integration » demanderait de deviner
 * laquelle, ou de toutes les revoquer.
 */
export const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  /** Debut de la clef, affichable. Ne permet pas de s'authentifier. */
  prefix: z.string(),
  entity: z.object({ id: z.number().int().positive(), name: z.string() }),
  profile: z.object({ id: z.number().int().positive(), name: z.string() }),
  owner: z.object({ id: z.number().int().positive(), displayName: z.string() }),
  includeSubEntities: z.boolean(),
  lastUsedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/**
 * Creation d'une clef.
 *
 * Ni entite ni profil a choisir : **la clef agit comme son createur**, avec le
 * contexte de travail qu'il a au moment ou il la cree. La regle tient en une
 * phrase -- une clef ne peut jamais faire plus que la personne qui l'a creee --
 * et elle ferme d'un coup toute une famille de questions sur l'elevation de
 * privileges.
 *
 * Elle a un cout, assume : changer le perimetre d'une clef demande d'en creer
 * une autre. C'est le bon sens pour un secret qu'on ne peut de toute facon pas
 * relire.
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  /**
   * Expiration, en jours. Absente vaut « sans expiration ».
   *
   * Proposee mais non imposee : une clef d'integration continue qui expire sans
   * prevenir casse une chaine un matin, et l'equipe qui la subit desactivera
   * l'expiration a la premiere occasion. Mieux vaut qu'elle soit choisie.
   */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});
export type CreateApiKey = z.infer<typeof createApiKeySchema>;

/**
 * Ce que rend la creation : la clef, **et son secret, une seule fois**.
 *
 * Un type distinct plutot qu'un champ facultatif sur `apiKeySchema` : le secret
 * ne doit exister que sur ce chemin-la, et un champ nullable partout ailleurs
 * inviterait a l'afficher dans une liste sans que rien ne s'y oppose.
 */
export const issuedApiKeySchema = apiKeySchema.extend({
  /** A copier maintenant : il n'est plus jamais montre. */
  token: z.string(),
});
export type IssuedApiKey = z.infer<typeof issuedApiKeySchema>;
