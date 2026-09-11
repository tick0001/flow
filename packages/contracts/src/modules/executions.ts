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
 * Ce que le **worker publie** sur le canal d'une execution.
 *
 * Une union discriminee plutot que quatre canaux : l'ordre relatif d'une ligne
 * de journal, d'une progression et d'un changement d'etat compte pour
 * l'affichage, et quatre abonnements distincts ne le garantiraient pas.
 *
 * Le changement d'etat ne porte que l'etat, et non le denouement complet : le
 * worker publie ce qu'il sait, l'API relaie ce que **ce lecteur-la** a le droit
 * de voir. Y mettre le detail ferait transiter par Redis une forme calculee pour
 * un compte, alors que plusieurs comptes lisent la meme execution.
 */
export const executionEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log'), payload: executionLogSchema }),
  z.object({ kind: z.literal('progress'), payload: executionProgressSchema }),
  z.object({ kind: z.literal('frame'), payload: executionFrameSchema }),
  z.object({
    kind: z.literal('status'),
    payload: z.object({ executionId: z.uuid(), status: executionStatusSchema }),
  }),
]);
export type ExecutionEvent = z.infer<typeof executionEventSchema>;

/**
 * Une execution telle qu'une liste la montre.
 *
 * Le nom et la version du bot sont **recopies** sur l'execution, et non lus dans
 * le registre a l'affichage : un bot se met a jour, se renomme, se retire. Aller
 * les chercher ferait afficher « v2.0.0 » sur une trace produite par la
 * precedente, ou vider la colonne le jour ou le dossier disparait -- alors que
 * l'historique est precisement ce que l'outil existe pour garder.
 */
export const executionSummarySchema = z.object({
  id: z.uuid(),
  botId: z.string(),
  botName: z.string(),
  botVersion: z.string(),
  status: executionStatusSchema,
  headed: z.boolean(),
  entity: z.object({ id: z.number().int().positive(), name: z.string() }),
  requestedBy: z.object({ id: z.number().int().positive(), displayName: z.string() }),
  createdAt: z.coerce.date(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  /**
   * Duree mesuree, posee a la fin. Nulle tant que l'execution court : la
   * calculer au vol depuis `startedAt` donnerait un chiffre qui bouge a chaque
   * rafraichissement, et l'horloge du client n'est pas celle du serveur.
   */
  durationMs: z.number().int().nonnegative().nullable(),
  message: z.string().nullable(),
  progress: executionProgressSchema.omit({ executionId: true }).nullable(),
  /**
   * Calcule par le serveur pour le compte qui interroge : le droit, sa portee et
   * l'etat de l'execution y sont deja croises. L'interface n'a donc pas a
   * refaire ce raisonnement, ni a se tromper differemment du serveur.
   */
  canCancel: z.boolean(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

/** Le detail : ce qu'on a demande, ce qui en est sorti, et qui la detient. */
export const executionDetailSchema = executionSummarySchema.extend({
  parameters: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  /** Identifiant du worker qui la detient ou l'a executee. */
  worker: z.string().nullable(),
  /**
   * L'interruption a ete demandee mais l'execution n'est pas encore terminee.
   *
   * Sans cet etat, le bouton « interrompre » resterait actif apres un clic --
   * une demande est asynchrone par nature, le worker la voit entre deux etapes.
   */
  cancelRequested: z.boolean(),
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;

/**
 * Ce que **l'API relaie** au navigateur, sur le flux d'une execution.
 *
 * Deux formes distinctes de celles que le worker publie, et la distinction porte
 * tout le dispositif :
 *
 *  - le **journal est un flux** : il s'ajoute, chaque ligne porte son rang, et
 *    une reprise apres coupure redemande « ce qui suit le rang n » ;
 *  - l'**etat est un instantane** : il s'ecrase, il ne se rejoue pas, et le
 *    renvoyer en entier a chaque changement evite au client de redemander le
 *    detail -- duree, message, resultat -- par une requete de plus.
 *
 * Les images ne sont ni l'un ni l'autre : elles sont perissables, et une image
 * manquee n'a aucun interet a etre rattrapee.
 */
export const executionStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), payload: executionDetailSchema }),
  z.object({ kind: z.literal('log'), payload: executionLogSchema }),
  z.object({ kind: z.literal('progress'), payload: executionProgressSchema }),
  z.object({ kind: z.literal('frame'), payload: executionFrameSchema }),
]);
export type ExecutionStreamEvent = z.infer<typeof executionStreamEventSchema>;

/**
 * Filtres d'une liste d'executions.
 *
 * `mine` existe en plus de la portee `own` du droit : quelqu'un qui voit toute
 * son entite veut souvent ne voir que ses propres lancements, sans changer de
 * profil pour autant.
 */
export const executionsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  botId: z.string().max(64).optional(),
  status: executionStatusSchema.optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1')
    .optional(),
});
export type ExecutionsQuery = z.infer<typeof executionsQuerySchema>;

/**
 * Lecture du journal, a partir d'un rang.
 *
 * `afterSeq` et non une pagination par page : le client suit un journal qui
 * s'allonge, et redemande « ce qui suit ce que j'ai deja ». Une pagination par
 * decalage reafficherait les memes lignes des qu'une nouvelle arrive.
 */
export const executionLogsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(-1).default(-1),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export type ExecutionLogsQuery = z.infer<typeof executionLogsQuerySchema>;
