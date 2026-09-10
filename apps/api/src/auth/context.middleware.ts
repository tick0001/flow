import { Injectable, type NestMiddleware } from '@nestjs/common';
import { negotiateLocale } from '@flow/i18n';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type FlowContext } from '../common/request-context.js';
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
    private readonly scopes: ScopeService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const session = await this.sessions.resolve(cookies?.[SESSION_COOKIE]);

    if (!session) {
      next();
      return;
    }

    const perimetre = await this.scopes.workingScope(
      session.userId,
      session.entityId,
      session.profileId,
      session.includeSubEntities,
    );

    const context: FlowContext = {
      sessionId: session.id,
      userId: session.userId,
      profileId: session.profileId,
      entityId: perimetre.entityId,
      entityPath: perimetre.entityPath,
      includeSubEntities: perimetre.includeSubEntities,
      scope: perimetre.scope,
      locale: negotiateLocale(request.headers['accept-language']),
      mustChangePassword: session.mustChangePassword,
    };

    runWithContext(context, () => {
      next();
    });
  }
}
