import { Injectable, type NestMiddleware } from '@nestjs/common';
import { negotiateLocale } from '@flow/i18n';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type FlowContext } from '../common/request-context.js';
import { ApiKeyService } from './api-key.service.js';
import { ScopeService } from './scope.service.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'flow_session';

/**
 * Etablit le contexte de travail pour toute la duree de la requete.
 *
 * Une requete sans session valide poursuit son chemin **sans contexte** : c'est
 * aux gardes de refuser l'acces. Ce decoupage laisse exister des routes
 * publiques -- sante, connexion -- sans exception dans le cablage, et garantit
 * qu'une route protegee mal declaree echoue au refus plutot qu'a la fuite : sans
 * contexte, les politiques rendent un perimetre vide.
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(
    private readonly sessions: SessionService,
    private readonly cles: ApiKeyService,
    private readonly scopes: ScopeService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const porteur = await this.identifier(request);

    if (!porteur) {
      next();
      return;
    }

    const perimetre = await this.scopes.workingScope(
      porteur.userId,
      porteur.entityId,
      porteur.profileId,
      porteur.includeSubEntities,
    );

    const context: FlowContext = {
      sessionId: porteur.sessionId,
      userId: porteur.userId,
      profileId: porteur.profileId,
      entityId: perimetre.entityId,
      entityPath: perimetre.entityPath,
      includeSubEntities: perimetre.includeSubEntities,
      scope: perimetre.scope,
      locale: negotiateLocale(request.headers['accept-language']),
      mustChangePassword: porteur.mustChangePassword,
    };

    runWithContext(context, () => {
      next();
    });
  }

  /**
   * Qui appelle : un cookie de session, ou une clef d'API.
   *
   * **Le cookie d'abord.** Un navigateur qui porte les deux -- un outil de test
   * d'API ouvert dans un onglet connecte -- doit agir comme la personne
   * connectee, pas comme la clef : c'est ce qu'elle voit a l'ecran, et l'inverse
   * serait deroutant.
   *
   * Les deux chemins produisent le **meme contexte**, et c'est ce qui fait que
   * rien en aval n'a besoin de savoir d'ou vient l'appel : politiques, droits et
   * portees s'appliquent a l'identique.
   */
  private async identifier(request: Request): Promise<Porteur | null> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const session = await this.sessions.resolve(cookies?.[SESSION_COOKIE]);

    if (session) {
      return {
        sessionId: session.id,
        userId: session.userId,
        profileId: session.profileId,
        entityId: session.entityId,
        includeSubEntities: session.includeSubEntities,
        mustChangePassword: session.mustChangePassword,
      };
    }

    const clef = await this.cles.resolve(request.headers.authorization);

    if (!clef) return null;

    return {
      sessionId: clef.id,
      userId: clef.userId,
      profileId: clef.profileId,
      entityId: clef.entityId,
      includeSubEntities: clef.includeSubEntities,
      // Une clef n'est pas un mot de passe : l'obligation d'en changer ne la
      // concerne pas. Elle porte son propre secret, que le changement de mot de
      // passe ne renouvelle pas -- et la bloquer casserait une chaine
      // d'integration parce que quelqu'un doit changer son mot de passe.
      mustChangePassword: false,
    };
  }
}

/** Ce qu'un moyen d'authentification, quel qu'il soit, apprend sur l'appelant. */
interface Porteur {
  sessionId: string;
  userId: number;
  profileId: number;
  entityId: number;
  includeSubEntities: boolean;
  mustChangePassword: boolean;
}
