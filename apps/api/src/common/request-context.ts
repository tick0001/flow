import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import type { RequestContext } from '@flow/db';

/**
 * Contexte de travail de la requete en cours.
 *
 * Il etend le contexte que la couche donnees injecte dans la transaction avec ce
 * dont l'application a besoin par ailleurs : session, entite active sous forme
 * d'identifiant, langue.
 */
export interface FlowContext extends RequestContext {
  sessionId: string;
  entityId: number;
  includeSubEntities: boolean;
  locale: string;
  /** Le compte doit changer de mot de passe : tout le reste de l API lui est ferme. */
  mustChangePassword: boolean;
}

const stockage = new AsyncLocalStorage<FlowContext>();

/** Execute le travail avec ce contexte, propage a tout l'arbre d'appels. */
export function runWithContext<T>(context: FlowContext, work: () => T): T {
  return stockage.run(context, work);
}

export function currentContext(): FlowContext | undefined {
  return stockage.getStore();
}

/**
 * Contexte obligatoire.
 *
 * Son absence n'est pas un cas fonctionnel mais un defaut de cablage : une route
 * protegee atteinte sans authentification, ou un travail de fond lance hors
 * contexte. Echouer bruyamment vaut mieux qu'executer une requete dont le
 * perimetre serait indefini -- d'autant que les politiques rendraient alors un
 * resultat vide, ce qui ressemble a une absence de donnees et non a un defaut.
 */
export function requireContext(): FlowContext {
  const context = stockage.getStore();

  if (!context) {
    throw new InternalServerErrorException(
      "Aucun contexte de requete : le perimetre d'entites serait indefini.",
    );
  }

  return context;
}
