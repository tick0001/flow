import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AvailableContext, SessionContext } from '@flow/contracts';
import { eq, users } from '@flow/db';
import { isLocale } from '@flow/i18n';
import { DatabaseService } from '../database/database.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { RightsService } from './rights.service.js';
import { ScopeService, type AuthorizedEntity } from './scope.service.js';
import { SessionService, type IssuedSession, type SessionRecord } from './session.service.js';

export interface LoginMetadata {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

function displayNameOf(user: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const parties = [user.firstName, user.lastName].filter(Boolean);

  return parties.length > 0 ? parties.join(' ') : user.username;
}

function toAvailableContext(ligne: AuthorizedEntity): AvailableContext {
  return {
    entity: {
      id: ligne.entityId,
      name: ligne.name,
      completeName: ligne.completeName,
      path: ligne.entityPath,
      level: ligne.entityPath.split('.').length - 1,
      parentId: null,
    },
    profile: { id: ligne.profileId, name: ligne.profileName },
    isRecursive: ligne.isRecursive,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly scopes: ScopeService,
    private readonly rights: RightsService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /**
   * Authentifie un compte et ouvre une session.
   *
   * Le message d'erreur est volontairement identique pour un identifiant
   * inconnu, un mot de passe faux et un compte desactive : distinguer les cas
   * revient a offrir un oracle d'existence de comptes.
   *
   * L'absence d'habilitation, elle, est dite explicitement -- le compte existe et
   * son mot de passe est bon, il n'y a plus rien a proteger, et laisser la
   * personne croire a une faute de frappe la ferait recommencer indefiniment.
   */
  async login(username: string, password: string, metadata: LoginMetadata): Promise<IssuedSession> {
    if (this.throttle.isBlocked(metadata.ipAddress, username)) {
      // 429 plutot que 401 : le compte n'est pas en cause, et un client qui
      // recoit 401 reessaie -- ce qui prolonge le blocage sans qu'il comprenne.
      throw new HttpException(
        'Trop de tentatives. Reessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const compte = await this.findByUsername(username);
    const valide = await this.passwords.verify(compte?.passwordHash ?? null, password);

    if (!compte || !valide || !compte.isActive) {
      this.throttle.registerFailure(metadata.ipAddress, username);

      throw new UnauthorizedException('Identifiants invalides.');
    }

    const disponibles = await this.scopes.authorizedEntities(compte.id);
    const choisi =
      disponibles.find((ligne) => ligne.entityId === compte.defaultEntityId) ?? disponibles[0];

    if (!choisi) {
      throw new UnauthorizedException("Aucune habilitation : ce compte n'a acces a rien.");
    }

    this.throttle.reset(metadata.ipAddress, username);

    await this.db.asOwner((tx) =>
      tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, compte.id)),
    );

    return this.sessions.issue(
      {
        userId: compte.id,
        profileId: choisi.profileId,
        entityId: choisi.entityId,
        includeSubEntities: choisi.isRecursive,
      },
      metadata,
    );
  }

  /** Etat complet de la session : qui, ou, avec quels droits, et vers quoi basculer. */
  async describeSession(session: SessionRecord): Promise<SessionContext> {
    const [compte] = await this.db.asOwner((tx) =>
      tx.select().from(users).where(eq(users.id, session.userId)),
    );

    if (!compte) throw new UnauthorizedException('Session orpheline.');

    const disponibles = await this.scopes.authorizedEntities(session.userId);
    const actif = disponibles.find(
      (ligne) => ligne.entityId === session.entityId && ligne.profileId === session.profileId,
    );

    // L'habilitation a pu etre retiree pendant que la session vivait. On refuse
    // plutot que de retomber sur une autre : basculer quelqu'un silencieusement
    // vers une entite qu'il n'a pas choisie est pire qu'une reconnexion.
    if (!actif) throw new UnauthorizedException('Habilitation revoquee.');

    const droits = await this.rights.rightsFor(session.profileId);
    const locale = compte.locale && isLocale(compte.locale) ? compte.locale : 'fr';

    return {
      user: {
        id: compte.id,
        username: compte.username,
        displayName: displayNameOf(compte),
        email: compte.email,
        locale,
        mustChangePassword: compte.mustChangePassword,
      },
      entity: toAvailableContext(actif).entity,
      profile: { id: actif.profileId, name: actif.profileName },
      includeSubEntities: session.includeSubEntities,
      rights: Object.fromEntries(droits),
      available: disponibles.map(toAvailableContext),
    };
  }

  /**
   * Bascule d'entite ou de profil.
   *
   * Le couple demande est verifie contre les habilitations reelles : sans cela,
   * un appel direct a l'API ferait entrer n'importe qui dans n'importe quelle
   * branche, l'interface n'etant qu'une commodite.
   */
  async switchContext(
    session: SessionRecord,
    cible: { entityId: number; profileId: number; includeSubEntities: boolean },
  ): Promise<void> {
    const perimetre = await this.scopes.workingScope(
      session.userId,
      cible.entityId,
      cible.profileId,
      cible.includeSubEntities,
    );

    await this.sessions.switchContext(session.id, {
      entityId: perimetre.entityId,
      profileId: cible.profileId,
      includeSubEntities: perimetre.includeSubEntities,
    });
  }

  /**
   * Change le mot de passe du compte de la session.
   *
   * L'ancien est exige meme quand le changement est impose. Sans lui, quiconque
   * met la main sur une session ouverte -- un poste laisse sans surveillance --
   * s'approprierait le compte definitivement.
   */
  async changePassword(userId: number, actuel: string, nouveau: string): Promise<void> {
    const [compte] = await this.db.asOwner((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );

    if (!compte) throw new UnauthorizedException('Session orpheline.');

    if (!(await this.passwords.verify(compte.passwordHash, actuel))) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    if (actuel === nouveau) {
      throw new BadRequestException("Le nouveau mot de passe doit differer de l'ancien.");
    }

    const condensat = await this.passwords.hash(nouveau);

    await this.db.asOwner((tx) =>
      tx
        .update(users)
        .set({ passwordHash: condensat, mustChangePassword: false, updatedAt: new Date() })
        .where(eq(users.id, userId)),
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  private async findByUsername(username: string) {
    const [compte] = await this.db.asOwner((tx) =>
      tx.select().from(users).where(eq(users.username, username)),
    );

    // Non supprime : `deletedAt` marque un compte retire sans effacer ses
    // executions passees, qui referencent son identifiant.
    return compte && compte.deletedAt === null ? compte : undefined;
  }
}
