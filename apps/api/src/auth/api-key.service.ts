import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApiKey, IssuedApiKey } from '@flow/contracts';
import { and, apiKeys, desc, entities, eq, isNull, lt, or, profiles, sql, users } from '@flow/db';
import { displayNameOf } from '../common/display-name.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from './rights.service.js';

/**
 * Prefixe visible d'une clef.
 *
 * `flow_` pour que la clef se reconnaisse au premier coup d'oeil dans un fichier
 * de configuration ou une variable d'environnement -- et, accessoirement, pour
 * que les outils qui cherchent des secrets dans les depots publics puissent la
 * detecter. Un secret qui ne ressemble a rien passe inapercu, y compris de ceux
 * qui voudraient prevenir sa fuite.
 */
const PREFIXE = 'flow_';

/** Longueur de la partie visible, apres le prefixe. */
const VISIBLE = 8;

/**
 * Condensat d'un secret de clef.
 *
 * SHA-256 et non Argon2, contrairement aux mots de passe, et la difference est
 * justifiee : un mot de passe est choisi par un humain, donc devinable, et le
 * cout de calcul d'Argon2 est ce qui rend l'attaque par dictionnaire
 * impraticable. Une clef est **256 bits tires au hasard** : il n'y a pas de
 * dictionnaire, et ralentir la verification ne ferait que ralentir chaque appel
 * d'API legitime.
 */
function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface ApiKeyRecord {
  id: string;
  userId: number;
  profileId: number;
  entityId: number;
  includeSubEntities: boolean;
}

/**
 * Les clefs d'API : un second moyen de s'authentifier, pour ce qui n'a pas de
 * navigateur.
 *
 * **Une clef agit comme son createur.** Ni entite ni profil a choisir : elle
 * reprend le contexte de travail de la personne au moment ou elle la cree. La
 * regle tient en une phrase -- une clef ne peut jamais faire plus que celui qui
 * l'a creee -- et elle ferme d'un coup toute une famille de questions sur
 * l'elevation de privileges.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rights: RightsService,
  ) {}

  /**
   * Emet une clef, et rend son secret **une seule fois**.
   *
   * Le secret n'est jamais relisible : seul son condensat est stocke. Une fuite
   * de la base ne livre donc aucune clef utilisable, et une clef perdue se
   * remplace plutot qu'elle ne se retrouve.
   */
  async issue(nom: string, expiresInDays?: number): Promise<IssuedApiKey> {
    const context = requireContext();
    const secret = randomBytes(32).toString('base64url');
    const visible = secret.slice(0, VISIBLE);
    const token = `${PREFIXE}${secret}`;

    const [creee] = await this.db.asUser((tx) =>
      tx
        .insert(apiKeys)
        .values({
          name: nom,
          prefix: `${PREFIXE}${visible}`,
          tokenHash: digest(secret),
          userId: context.userId,
          profileId: context.profileId,
          entityId: context.entityId,
          includeSubEntities: context.includeSubEntities,
          expiresAt:
            expiresInDays === undefined
              ? null
              : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        })
        .returning({ id: apiKeys.id }),
    );

    if (!creee) throw new ForbiddenException("La clef n'a pas pu etre creee.");

    const [relue] = await this.list(creee.id);

    if (!relue) throw new ForbiddenException("La clef n'a pas pu etre relue.");

    return { ...relue, token };
  }

  /**
   * Les clefs vivantes du perimetre.
   *
   * Les revoquees ne sont pas rendues : une liste ou l'on doit distinguer les
   * vivantes des mortes se lit mal, et la question qu'on se pose devant cet ecran
   * est toujours « qu'est-ce qui peut appeler mon installation en ce moment ».
   * L'historique des revocations, si le besoin vient, sera une autre vue.
   */
  async list(id?: string): Promise<ApiKey[]> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'apikey', 'read');
    const conditions = [isNull(apiKeys.revokedAt)];

    if (portee === 'own') conditions.push(eq(apiKeys.userId, context.userId));
    if (portee === 'entity') conditions.push(eq(apiKeys.entityId, context.entityId));
    if (id) conditions.push(eq(apiKeys.id, id));

    const lignes = await this.db.asUser((tx) =>
      tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          entityId: apiKeys.entityId,
          entityName: entities.name,
          profileId: apiKeys.profileId,
          profileName: profiles.name,
          userId: apiKeys.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
          includeSubEntities: apiKeys.includeSubEntities,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .innerJoin(entities, eq(entities.id, apiKeys.entityId))
        .innerJoin(profiles, eq(profiles.id, apiKeys.profileId))
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(and(...conditions))
        .orderBy(desc(apiKeys.createdAt)),
    );

    return lignes.map((ligne) => ({
      id: ligne.id,
      name: ligne.name,
      prefix: ligne.prefix,
      entity: { id: ligne.entityId, name: ligne.entityName },
      profile: { id: ligne.profileId, name: ligne.profileName },
      owner: { id: ligne.userId, displayName: displayNameOf(ligne) },
      includeSubEntities: ligne.includeSubEntities,
      lastUsedAt: ligne.lastUsedAt,
      expiresAt: ligne.expiresAt,
      createdAt: ligne.createdAt,
    }));
  }

  /**
   * Revoque une clef.
   *
   * Marquee et non supprimee : la ligne garde le prefixe et la date de derniere
   * utilisation, de quoi repondre a « qu'est-ce qui appelait avec cette clef »
   * apres l'avoir coupee -- ce qui est exactement la question qu'on se pose
   * quand on la revoque en urgence.
   */
  async revoke(id: string): Promise<void> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'apikey', 'delete');

    const [existante] = await this.db.asUser((tx) =>
      tx
        .select({ userId: apiKeys.userId })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt))),
    );

    if (!existante) throw new NotFoundException("Cette clef n'existe pas.");

    if (portee === 'own' && existante.userId !== context.userId) {
      throw new ForbiddenException('Ce droit ne permet de revoquer que vos propres clefs.');
    }

    await this.db.asUser((tx) =>
      tx
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(eq(apiKeys.id, id)),
    );
  }

  /**
   * Resout une clef presentee, ou rend null.
   *
   * Par le role proprietaire : cet appel **precede** l'existence du contexte
   * qu'il sert justement a construire -- exactement comme la resolution d'une
   * session.
   *
   * Le compte est relu et verifie a chaque appel, pour la meme raison que pour
   * une session : desactiver un compte doit couper ses clefs, sans quoi
   * quelqu'un dont on retire l'acces continue d'appeler l'API.
   */
  async resolve(entete: string | undefined): Promise<ApiKeyRecord | null> {
    const token = lireLEntete(entete);

    if (!token?.startsWith(PREFIXE)) return null;

    const secret = token.slice(PREFIXE.length);

    if (secret.length < 16) return null;

    const resolue = await this.db.asOwner(async (tx) => {
      const [trouvee] = await tx
        .select({
          id: apiKeys.id,
          tokenHash: apiKeys.tokenHash,
          userId: apiKeys.userId,
          profileId: apiKeys.profileId,
          entityId: apiKeys.entityId,
          includeSubEntities: apiKeys.includeSubEntities,
          expiresAt: apiKeys.expiresAt,
          isActive: users.isActive,
          deletedAt: users.deletedAt,
        })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(and(eq(apiKeys.tokenHash, digest(secret)), isNull(apiKeys.revokedAt)));

      if (!trouvee) return null;

      // Comparaison a temps constant, bien que la recherche se fasse deja par le
      // condensat : la ligne trouvee doit encore correspondre, et une egalite
      // naive laisserait fuir la longueur du prefixe commun.
      const attendu = Buffer.from(trouvee.tokenHash, 'utf8');
      const fourni = Buffer.from(digest(secret), 'utf8');

      if (attendu.length !== fourni.length || !timingSafeEqual(attendu, fourni)) return null;

      if (trouvee.expiresAt && trouvee.expiresAt.getTime() < Date.now()) return null;
      if (!trouvee.isActive || trouvee.deletedAt !== null) return null;

      return {
        id: trouvee.id,
        userId: trouvee.userId,
        profileId: trouvee.profileId,
        entityId: trouvee.entityId,
        includeSubEntities: trouvee.includeSubEntities,
      };
    });

    if (resolue) this.marquerUtilisee(resolue.id);

    return resolue;
  }

  /**
   * Note qu'une clef vient de servir.
   *
   * **Hors de la transaction de lecture, et sans l'attendre.** Une premiere
   * version l'ecrivait dedans, en `void` : la transaction se terminait avant que
   * l'ecriture ne parte, et la colonne restait vide -- ce qui se voit mal, la
   * clef fonctionnant parfaitement par ailleurs. Le defaut n'avait de consequence
   * qu'au moment ou quelqu'un cherche a savoir si une clef sert encore avant de
   * la couper, c'est-a-dire au pire moment.
   *
   * L'ecriture est **espacee** : une chaine d'integration qui appelle cent fois
   * par minute produirait autrement cent ecritures sur la meme ligne, pour une
   * information dont la minute suffit largement.
   */
  private marquerUtilisee(id: string): void {
    void this.db
      .asOwner((tx) =>
        tx
          .update(apiKeys)
          .set({ lastUsedAt: sql`now()` })
          .where(
            and(
              eq(apiKeys.id, id),
              or(
                isNull(apiKeys.lastUsedAt),
                lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`),
              ),
            ),
          ),
      )
      .catch(() => {
        // Une note d'exploitation perdue ne doit jamais faire echouer un appel
        // par ailleurs legitime.
      });
  }
}

/**
 * Lit la clef dans l'en-tete `Authorization`.
 *
 * `Bearer` accepte avec ou sans, parce que les deux se rencontrent dans la vraie
 * vie : `curl -H "Authorization: Bearer flow_..."` d'un cote, un client qui pose
 * la clef nue de l'autre. Refuser la seconde forme aurait produit un 401 sans
 * explication sur une requete qui porte pourtant la bonne clef.
 */
function lireLEntete(entete: string | undefined): string | null {
  if (!entete) return null;

  const valeur = entete.trim();

  if (valeur.toLowerCase().startsWith('bearer ')) return valeur.slice(7).trim();

  return valeur;
}
