import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { currentContext } from '../../common/request-context.js';

/**
 * Routes atteignables malgre l'obligation de changer de mot de passe.
 *
 * Le strict necessaire pour en sortir : savoir ou l'on en est, changer le mot de
 * passe, s'en aller. En ouvrir une de plus reviendrait a rendre l'obligation
 * contournable, ce qu'elle est deja par nature si l'on n'y prend pas garde.
 */
const AUTORISEES = new Set([
  'GET /api/auth/session',
  'POST /api/auth/password',
  'POST /api/auth/logout',
]);

/**
 * Ferme l'API tant que le mot de passe impose n'a pas ete change.
 *
 * Garde **globale**, et c'est le point : l'interface bloquait deja, mais un
 * appel direct a l'API ne rencontrait rien. Un mot de passe pose par un
 * administrateur -- ou par l'initialisation, donc publie dans un guide -- est
 * connu de quelqu'un d'autre : le laisser servir indefiniment a qui n'utilise
 * pas le navigateur viderait l'obligation de son sens.
 *
 * Elle ne s'applique qu'a une requete deja authentifiee : sans contexte, ce sont
 * les autres gardes qui refusent.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(execution: ExecutionContext): boolean {
    const context = currentContext();

    if (!context?.mustChangePassword) return true;

    const requete = execution.switchToHttp().getRequest<Request>();
    // `originalUrl` et non `path` : le prefixe global `/api` en fait partie, et
    // une chaine de requete se coupe explicitement plutot que par hasard.
    const chemin = requete.originalUrl.split('?')[0] ?? '';

    if (AUTORISEES.has(`${requete.method} ${chemin}`)) return true;

    throw new ForbiddenException('Changez votre mot de passe avant toute autre action.');
  }
}
