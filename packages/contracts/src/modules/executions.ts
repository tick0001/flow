import { z } from 'zod';

/**
 * Statut d'une execution.
 *
 * Six valeurs et non cinq : `abandoned` est distingue de `cancelled`. La
 * premiere dit qu'aucun worker ne detient plus l'execution -- un worker tue, une
 * machine redemarree --, la seconde qu'une personne l'a interrompue. Les
 * confondre effacerait la seule trace d'une panne d'infrastructure, et ferait
 * conclure a un utilisateur capricieux la ou il faut regarder les journaux du
 * conteneur.
 *
 * `queued` couvre aussi bien l'attente d'un creneau que l'attente d'un worker :
 * de l'exterieur c'est la meme chose, et distinguer les deux obligerait a
 * publier un etat que rien ne sait observer de facon fiable.
 */
export const executionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'abandoned',
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/**
 * Statuts dont on ne sort plus.
 *
 * Declares une fois ici parce que trois endroits en dependent -- la purge, le
 * balayage des executions orphelines et l'affichage temps reel -- et que trois
 * listes ecrites a la main finiraient par ne plus s'accorder.
 */
export const TERMINAL_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'abandoned',
] as const satisfies readonly ExecutionStatus[];

export const isTerminal = (statut: ExecutionStatus): boolean =>
  (TERMINAL_STATUSES as readonly ExecutionStatus[]).includes(statut);

/**
 * Niveau d'une ligne de journal.
 *
 * Une echelle de gravite, et rien d'autre : « filtrer a partir de
 * l'avertissement » doit avoir un sens. BotManager y avait ajoute un niveau
 * `Success`, qui n'est pas une gravite mais une intention d'affichage -- il
 * rendait tout filtrage ambigu, puisqu'un succes n'est ni au-dessus ni en
 * dessous d'un avertissement.
 *
 * La reussite se lit sur le statut de l'execution et sur les etapes de
 * progression, ou elle est a sa place.
 */
export const logLevelSchema = z.enum(['debug', 'info', 'warning', 'error']);
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Ligne de journal telle qu'elle est diffusee et persistee. */
export const executionLogSchema = z.object({
  executionId: z.uuid(),
  /**
   * Rang de la ligne dans l'execution, attribue a l'ecriture.
   *
   * L'horodatage ne suffit pas a ordonner : deux lignes emises dans la meme
   * milliseconde s'afficheraient dans un ordre arbitraire, et c'est frequent
   * quand un bot journalise en boucle. Le rang sert aussi de point de reprise
   * apres une coupure du WebSocket -- le client redemande « ce qui suit le rang
   * n » au lieu de tout recharger.
   */
  seq: z.number().int().nonnegative(),
  at: z.coerce.date(),
  level: logLevelSchema,
  message: z.string(),
});
export type ExecutionLog = z.infer<typeof executionLogSchema>;

/**
 * Progression emise par un bot.
 *
 * `percent` est facultatif : beaucoup de bots savent dire ou ils en sont sans
 * savoir combien il reste. Exiger un pourcentage les pousserait a en inventer
 * un, et une barre qui recule est pire qu'une barre absente.
 */
export const executionProgressSchema = z.object({
  executionId: z.uuid(),
  percent: z.number().int().min(0).max(100).nullable(),
  step: z.string().max(200),
});
export type ExecutionProgress = z.infer<typeof executionProgressSchema>;

/** Une image du navigateur, diffusee pendant un run visible. */
export const executionFrameSchema = z.object({
  executionId: z.uuid(),
  /** JPEG encode en base64, tel que le screencast CDP le produit. */
  data: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ExecutionFrame = z.infer<typeof executionFrameSchema>;

/**
 * Ce que le worker renvoie a la fin.
 *
 * `output` est un objet libre : c'est la donnee metier du bot, dont le coeur ne
 * peut rien savoir. Il est stocke en `jsonb` et rendu tel quel.
 */
export const executionOutcomeSchema = z.object({
  status: executionStatusSchema,
  message: z.string().max(2000).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
  durationMs: z.number().int().nonnegative(),
  /** Identifiants des fichiers deposes dans le stockage : captures, traces. */
  artifacts: z.array(z.uuid()),
});
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;

/**
 * Message diffuse par Redis pub/sub, puis relaye en WebSocket.
 *
 * Une union discriminee plutot que trois canaux : l'ordre relatif d'un log,
 * d'une progression et d'un changement de statut compte pour l'affichage, et
 * trois abonnements distincts ne le garantiraient pas.
 */
export const executionEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log'), payload: executionLogSchema }),
  z.object({ kind: z.literal('progress'), payload: executionProgressSchema }),
  z.object({ kind: z.literal('frame'), payload: executionFrameSchema }),
  z.object({
    kind: z.literal('status'),
    payload: z.object({
      executionId: z.uuid(),
      status: executionStatusSchema,
      outcome: executionOutcomeSchema.nullable(),
    }),
  }),
]);
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
