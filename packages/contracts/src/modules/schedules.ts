import { z } from 'zod';
import { executionSummarySchema } from './executions.js';

/**
 * Expression cron a cinq champs : minute, heure, jour, mois, jour de semaine.
 *
 * **Cinq et non six.** Le sixieme champ -- les secondes -- existe dans certaines
 * bibliotheques, et il n'a pas sa place ici : une execution ouvre un navigateur,
 * ce qui prend des secondes. Une planification a la seconde promettrait une
 * precision que rien ne peut tenir, et inviterait a declencher toutes les dix
 * secondes un travail qui en prend trente.
 *
 * La forme n'est verifiee qu'en gros ici : c'est l'analyseur du serveur qui
 * tranche, et lui seul sait ce qu'il accepte. Une expression reguliere qui
 * pretendrait valider cron finirait par refuser une syntaxe correcte -- les pas,
 * les listes, les noms de mois -- ou par en accepter une fausse.
 */
export const cronSchema = z
  .string()
  .min(9)
  .max(120)
  .regex(/^[\d*,/\-A-Za-z? ]+$/, 'expression cron invalide')
  .refine((valeur) => valeur.trim().split(/\s+/).length === 5, 'cinq champs attendus');

/**
 * Fuseau horaire d'une planification, en notation IANA.
 *
 * Obligatoire et explicite. Une planification a neuf heures ne veut rien dire
 * sans fuseau : le serveur tourne peut-etre en UTC, l'organisation est a Paris,
 * et l'heure d'ete decale l'une par rapport a l'autre deux fois par an. La
 * stocker resout aussi le cas d'une installation qui sert plusieurs pays.
 */
export const timezoneSchema = z.string().min(3).max(64);

/** Une planification, telle que l'interface la montre. */
export const scheduleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  botId: z.string(),
  /** Nom du bot au moment de la lecture, ou null s'il n'est plus depose. */
  botName: z.string().nullable(),
  cron: z.string(),
  timezone: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  headed: z.boolean(),
  isActive: z.boolean(),
  entity: z.object({ id: z.number().int().positive(), name: z.string() }),
  owner: z.object({ id: z.number().int().positive(), displayName: z.string() }),
  /**
   * Prochain declenchement, calcule et stocke.
   *
   * Stocke plutot que recalcule a l'affichage : c'est sur cette colonne que le
   * planificateur interroge, et deux calculs -- un pour afficher, un pour
   * declencher -- pourraient ne pas dire la meme chose.
   */
  nextRunAt: z.coerce.date().nullable(),
  lastRunAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  canManage: z.boolean(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

/** Le detail : la planification et ses derniers declenchements. */
export const scheduleDetailSchema = scheduleSchema.extend({
  recentExecutions: z.array(executionSummarySchema),
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;

/**
 * Creation d'une planification.
 *
 * Les parametres suivent la meme route que pour un lancement a la main : valides
 * contre le schema du bot **a la creation**, et non au premier declenchement.
 * Une planification fautive doit se voir tout de suite, pas a trois heures du
 * matin dans un journal que personne ne lit.
 */
export const createScheduleSchema = z.object({
  name: z.string().min(1).max(120),
  botId: z.string().min(3).max(64),
  cron: cronSchema,
  timezone: timezoneSchema,
  parameters: z.record(z.string(), z.unknown()).default({}),
  headed: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateSchedule = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = createScheduleSchema.partial();
export type UpdateSchedule = z.infer<typeof updateScheduleSchema>;

/**
 * Ce que rend l'aperçu d'une expression cron.
 *
 * L'interface la demande pendant la saisie : voir « les cinq prochains
 * declenchements » vaut mieux que relire une expression a six champs pour se
 * convaincre qu'on a compris. C'est le serveur qui calcule, avec l'analyseur qui
 * declenchera reellement -- un apercu calcule par une autre bibliotheque
 * mentirait tot ou tard.
 */
export const cronPreviewSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
  next: z.array(z.coerce.date()),
});
export type CronPreview = z.infer<typeof cronPreviewSchema>;
