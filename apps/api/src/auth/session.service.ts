import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sessions, sql, users } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';

/** Duree de vie glissante d'une session inactive. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionRecord {
  id: string;
  userId: number;
  profileId: number;
  entityId: number;
  includeSubEntities: boolean;
  /**
   * Le compte doit-il changer de mot de passe avant toute autre chose ?
   *
   * Porte par la session et non relu a la demande : la garde qui bloque le
   * reste de l API le consulte a chaque requete, et une requete de plus par
   * appel pour un booleen serait payee par tout le monde.
   */
  mustChangePassword: boolean;
}

export interface IssuedSession extends SessionRecord {
  /** Valeur a poser dans le cookie. Le serveur n'en conserve que le condensat. */
  cookieValue: string;
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Sessions opaques, revocables cote serveur.
 *
 * Un jeton opaque plutot qu'un JWT : la revocation immediate compte davantage
 * ici que l'absence d'acces a la base, et une deconnexion doit prendre effet
 * tout de suite. Seul le condensat du secret est stocke, donc une fuite de la
 * base ne permet pas de rejouer les sessions.
 */
@Injectable()
export class SessionService {
  constructor(private readonly db: DatabaseService) {}

  async issue(
    record: Omit<SessionRecord, 'id'>,
    metadata: { userAgent?: string | undefined; ipAddress?: string | undefined },
  ): Promise<IssuedSession> {
    const secret = randomBytes(32).toString('base64url');

    const [created] = await this.db.asOwner((tx) =>
      tx
        .insert(sessions)
        .values({
          userId: record.userId,
          profileId: record.profileId,
          entityId: record.entityId,
          includeSubEntities: record.includeSubEntities,
          tokenHash: digest(secret),
          userAgent: metadata.userAgent ?? null,
          ipAddress: metadata.ipAddress ?? null,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        })
        .returning(),
    );

    if (!created) throw new Error('Creation de session impossible.');

    return {
      id: created.id,
      userId: created.userId,
      profileId: created.profileId,
      entityId: created.entityId,
      includeSubEntities: created.includeSubEntities,
      mustChangePassword: record.mustChangePassword,
      cookieValue: `${created.id}.${secret}`,
    };
  }

  /**
   * Resout un cookie en session valide, en prolongeant sa duree de vie.
   *
   * Le compte est relu **a chaque requete**, joint a la session, et pour deux
   * raisons qui ne se voient pas au premier regard :
   *
   *  - **Desactiver ou supprimer un compte doit fermer ses sessions ouvertes.**
   *    Sans cette verification, quelqu'un dont on retire l'acces continue de
   *    travailler jusqu'a l'expiration de son jeton -- soit une demi-journee --
   *    et l'administrateur qui vient de le desactiver n'en sait rien.
   *  - **L'obligation de changer de mot de passe doit valoir pour l'API**, pas
   *    seulement pour l'interface. Un mot de passe pose par un administrateur
   *    est connu de lui : le laisser servir indefiniment a qui appelle l'API
   *    directement viderait l'obligation de son sens.
   *
   * Une jointure et non une requete de plus : c'est le meme aller-retour.
   */
  async resolve(cookieValue: string | undefined): Promise<SessionRecord | null> {
    if (!cookieValue) return null;

    const separator = cookieValue.indexOf('.');
    if (separator <= 0) return null;

    const id = cookieValue.slice(0, separator);
    const secret = cookieValue.slice(separator + 1);

    return this.db.asOwner(async (tx) => {
      const [found] = await tx
        .select({
          session: sessions,
          isActive: users.isActive,
          deletedAt: users.deletedAt,
          mustChangePassword: users.mustChangePassword,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));

      if (!found || found.session.expiresAt.getTime() < Date.now()) return null;

      // Comparaison a temps constant : une comparaison naive laisserait fuir la
      // longueur du prefixe commun, donc le secret, octet par octet.
      const expected = Buffer.from(found.session.tokenHash, 'utf8');
      const actual = Buffer.from(digest(secret), 'utf8');

      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

      if (!found.isActive || found.deletedAt !== null) return null;

      await tx
        .update(sessions)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
        .where(eq(sessions.id, id));

      return {
        id: found.session.id,
        userId: found.session.userId,
        profileId: found.session.profileId,
        entityId: found.session.entityId,
        includeSubEntities: found.session.includeSubEntities,
        mustChangePassword: found.mustChangePassword,
      };
    });
  }

  /**
   * Relit une session par son identifiant, sans jeton.
   *
   * Reserve aux appels deja authentifies -- le contexte porte l'identifiant --
   * qui ont besoin de relire l'etat. Ne remplace jamais `resolve` : celle-la
   * verifie le secret du cookie, celle-ci suppose la verification deja faite.
   * Les confondre reviendrait a accepter un identifiant de session nu comme
   * preuve d'identite.
   *
   * Elle refait en revanche **toutes les verifications de vivacite** : revoquee,
   * expiree, compte desactive, compte supprime. Elle ne les faisait pas, ce qui
   * suffisait a son premier appelant -- une relecture quelques millisecondes
   * apres l'authentification. Un flux temps reel s'en sert autrement : il vit
   * des minutes, et sans ces controles une session fermee pendant qu'on regarde
   * continuerait de recevoir.
   */
  async resolveById(sessionId: string): Promise<SessionRecord | null> {
    const [trouvee] = await this.db.asOwner((tx) =>
      tx
        .select({
          session: sessions,
          isActive: users.isActive,
          deletedAt: users.deletedAt,
          mustChangePassword: users.mustChangePassword,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt))),
    );

    if (!trouvee) return null;
    if (trouvee.session.expiresAt.getTime() < Date.now()) return null;
    if (!trouvee.isActive || trouvee.deletedAt !== null) return null;

    return {
      id: trouvee.session.id,
      userId: trouvee.session.userId,
      profileId: trouvee.session.profileId,
      entityId: trouvee.session.entityId,
      includeSubEntities: trouvee.session.includeSubEntities,
      mustChangePassword: trouvee.mustChangePassword,
    };
  }

  /** Change l'entite ou le profil actif sans rouvrir de session. */
  async switchContext(
    sessionId: string,
    context: { entityId: number; profileId: number; includeSubEntities: boolean },
  ): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.update(sessions).set(context).where(eq(sessions.id, sessionId)),
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId)),
    );
  }

  /** Purge les sessions expirees. Appelee par une tache planifiee. */
  async purgeExpired(): Promise<number> {
    return this.db.asOwner(async (tx) => {
      const result = await tx.execute(
        sql`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'`,
      );

      return result.rowCount ?? 0;
    });
  }
}
