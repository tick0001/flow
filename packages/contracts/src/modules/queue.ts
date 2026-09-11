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

/**
 * Periode du battement de coeur d'un worker sur les executions qu'il detient.
 *
 * Un worker tue ne vient pas dire qu'il est parti : sans ce battement, une
 * execution resterait `running` pour toujours, et rien ne distinguerait un run
 * d'une heure d'une machine redemarree.
 */
export const BATTEMENT_MS = 15_000;

/**
 * Silence au-dela duquel une execution est declaree orpheline.
 *
 * Quatre battements manques, et non un : un seul saute sur une pause du
 * ramasse-miettes ou une base momentanement lente, et declarer abandonnee une
 * execution qui tourne encore est bien pire que d'attendre une minute -- on
 * perdrait son resultat alors qu'il allait arriver.
 *
 * **Derive de la periode plutot que reglable.** Deux variables d'environnement,
 * une dans le worker et une dans l'API, finiraient par se contredire sur une
 * installation : un delai plus court que la periode ferait declarer orphelines
 * toutes les executions, en permanence, sans qu'aucun journal ne dise pourquoi.
 */
export const BATTEMENT_PERDU_MS = BATTEMENT_MS * 4;

/**
 * Canal de diffusion d'une execution : journal, progression, statut, images.
 *
 * **Un canal par execution, et non un canal global.** Un canal unique obligerait
 * chaque instance d'API a recevoir tout ce que produisent toutes les executions
 * de l'installation -- y compris les images du screencast, qui pesent -- pour
 * jeter presque tout. L'abonnement suit donc les lecteurs : la premiere personne
 * qui ouvre une execution l'ouvre, la derniere qui part le ferme.
 */
export const canalExecution = (executionId: string): string => `flow.execution.${executionId}`;

/**
 * Canal par lequel l'API dit qu'on regarde une execution.
 *
 * Il ne sert qu'aux images. Le journal et la progression sont publies de toute
 * facon -- ils sont minuscules et deja ecrits en base --, mais **encoder des
 * images que personne ne regarde couterait un vrai budget processeur au worker**,
 * pris sur l'execution elle-meme. C'est exactement ce que faisait l'outil
 * remplace, qui poussait une capture PNG toutes les 800 ms a chaque session
 * ouverte, qu'on regarde ou non.
 */
export const CANAL_REGARD = 'flow.regard';

export const watchOrderSchema = z.object({
  executionId: z.uuid(),
  /** Nombre de lecteurs. Zero arrete la diffusion d'images. */
  watchers: z.number().int().nonnegative(),
});
export type WatchOrder = z.infer<typeof watchOrderSchema>;

/**
 * Periode a laquelle l'API repete qu'on regarde encore.
 *
 * Le signal se repete plutot que de s'annoncer une fois : une instance d'API qui
 * meurt pendant qu'on regarde ne dira jamais qu'on a cesse, et le worker
 * encoderait des images pour personne jusqu'a la fin du run.
 */
export const REGARD_RAPPEL_MS = 10_000;

/** Silence au-dela duquel le worker considere que plus personne ne regarde. */
export const REGARD_PERIME_MS = REGARD_RAPPEL_MS * 3;

/**
 * Canal de la vie des executions : elles partent, elles se terminent.
 *
 * **Global, et volontairement pauvre.** Il ne porte ni journal, ni progression,
 * ni image -- seulement le fait qu'une execution a commence ou fini, et de quoi
 * la retrouver. Toutes les instances d'API l'ecoutent en permanence, la ou le
 * canal d'une execution ne s'ouvre que si quelqu'un la regarde.
 *
 * Il existe pour les plugins. Sans lui, l'API ne sait jamais qu'une execution
 * s'est terminee : elle l'apprend en relisant la base quand on la lui demande,
 * ce qui suffit a afficher une page et pas a declencher quoi que ce soit. Un
 * evenement `execution.terminee` aurait alors ete une promesse vide.
 *
 * L'invariant du jalon J4 vaut ici aussi : la ligne est ecrite avant d'etre
 * publiee. Un plugin qui relit l'execution a la reception la trouve dans l'etat
 * annonce.
 */
export const CANAL_VIE = 'flow.vie';

export const executionLifeSchema = z.object({
  phase: z.enum(['lancee', 'terminee']),
  executionId: z.uuid(),
  botId: z.string(),
  /** De quoi reconstituer le contexte de travail sans relire la base. */
  userId: z.number().int().positive(),
  profileId: z.number().int().positive(),
  entityPath: z.string().min(1),
  /** Renseignes a la fin seulement. */
  status: z.string().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  message: z.string().nullable().optional(),
});
export type ExecutionLife = z.infer<typeof executionLifeSchema>;
