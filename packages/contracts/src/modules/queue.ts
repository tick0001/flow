import { z } from 'zod';

/**
 * Ce qui passe par Redis entre l'API et les workers.
 *
 * Deux mecanismes distincts, et la distinction porte tout le jalon J3 :
 *
 *  - la **file** transporte l'intention de faire. Elle est durable, elle
 *    s'accumule, elle se rejoue ;
 *  - la **diffusion** transporte un ordre qui n'a de sens qu'immediatement.
 *    Personne a l'ecoute, aucune trace : c'est precisement ce qu'on veut d'une
 *    interruption, dont l'etat durable vit en base.
 *
 * Les confondre aurait donne soit une interruption perdue quand le worker
 * redemarre, soit une file qui garde des ordres devenus faux.
 */

/** Nom de la file d'executions. */
export const EXECUTION_QUEUE = 'flow.executions';

/**
 * Ce qu'un travail porte : l'identifiant de l'execution, et rien de plus.
 *
 * Tout le reste -- parametres, bot, entite, demandeur -- est lu en base par le
 * worker. C'est le principe « l'etat vit en base, la file ne fait que cadencer » :
 * un travail recopiant les parametres deviendrait faux si la ligne changeait, et
 * un vidage de Redis ne perdrait pas seulement l'ordre mais son contenu.
 *
 * `botId` fait exception, et pour une seule raison : lire une file dans un outil
 * de supervision sans pouvoir dire de quel bot il s'agit ne sert a rien.
 */
export const executionJobSchema = z.object({
  executionId: z.uuid(),
  botId: z.string().min(3).max(64),
});
export type ExecutionJob = z.infer<typeof executionJobSchema>;

/**
 * Canal des demandes d'interruption.
 *
 * Un seul canal, et non un par execution : tous les workers l'ecoutent, et celui
 * qui detient l'execution visee agit. Un canal par execution obligerait chaque
 * worker a gerer un abonnement de plus par run -- pour un evenement qui n'arrive
 * presque jamais.
 *
 * La diffusion ne fait que **hater** l'interruption. L'intention est ecrite en
 * base avant d'etre publiee : un worker qui redemarre la relit, et un worker qui
 * n'ecoutait pas au bon moment la voit a son prochain battement de coeur.
 */
export const CANAL_ANNULATION = 'flow.annulation';

export const cancelOrderSchema = z.object({ executionId: z.uuid() });
export type CancelOrder = z.infer<typeof cancelOrderSchema>;
