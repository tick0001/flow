import { z } from 'zod';
import { executionStatusSchema } from './executions.js';

/**
 * Fenetre d'observation.
 *
 * En jours et non en bornes de dates. Les questions qu'on pose a un tableau de
 * bord sont « depuis une semaine », « depuis un mois » -- jamais « du 3 au 17 ».
 * Des bornes libres demanderaient deux selecteurs de date pour un usage qui se
 * couvre par quatre boutons, et compliqueraient la comparaison d'une periode a
 * la precedente.
 */
export const periodeSchema = z.coerce.number().int().min(1).max(365).default(30);

export const statsQuerySchema = z.object({
  jours: periodeSchema,
  /** Restreindre a un bot. Utile depuis le catalogue. */
  botId: z.string().max(64).optional(),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

/**
 * Les chiffres de tete.
 *
 * `medianeMs` et non une moyenne : une execution qui part en delai d'attente de
 * trente secondes tire une moyenne bien au-dela de ce que vivent les autres, et
 * « la duree habituelle » cesse alors de vouloir dire quoi que ce soit. Le
 * quatre-vingt-quinzieme centile dit ce qui reste, c'est-a-dire les cas lents.
 */
export const apercuStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  parStatut: z.record(executionStatusSchema, z.number().int().nonnegative()),
  /**
   * Part de reussites parmi les executions **terminees**.
   *
   * Les executions en cours ou en attente en sont exclues : les compter comme
   * des echecs ferait plonger le taux a chaque rafale de lancements, et les
   * compter comme des reussites le ferait mentir dans l'autre sens.
   *
   * Nul quand rien n'est termine : un taux sur zero execution serait un chiffre
   * invente, et « 0 % » se lirait comme une panne.
   */
  tauxReussite: z.number().min(0).max(1).nullable(),
  medianeMs: z.number().int().nonnegative().nullable(),
  p95Ms: z.number().int().nonnegative().nullable(),
});
export type ApercuStats = z.infer<typeof apercuStatsSchema>;

/** Un jour de la tendance. Les jours sans execution y figurent, a zero. */
export const jourStatsSchema = z.object({
  jour: z.coerce.date(),
  reussies: z.number().int().nonnegative(),
  echouees: z.number().int().nonnegative(),
  autres: z.number().int().nonnegative(),
});
export type JourStats = z.infer<typeof jourStatsSchema>;

/** Ce qu'un bot a produit sur la periode. */
export const botStatsSchema = z.object({
  botId: z.string(),
  botName: z.string(),
  total: z.number().int().nonnegative(),
  echouees: z.number().int().nonnegative(),
  tauxReussite: z.number().min(0).max(1).nullable(),
  medianeMs: z.number().int().nonnegative().nullable(),
  dernierEchec: z.coerce.date().nullable(),
});
export type BotStats = z.infer<typeof botStatsSchema>;

/**
 * Un echec regroupe, et c'est le coeur de ce jalon.
 *
 * Les messages d'echec ne se repetent presque jamais a l'identique : ils portent
 * une adresse, un delai, un identifiant. Les lister tels quels donne deux cents
 * lignes uniques ou l'on ne voit rien -- alors qu'il n'y a souvent que trois
 * causes.
 *
 * La **signature** est le message debarrasse de ce qui varie. C'est elle qui
 * transforme « deux cents echecs distincts » en « trois causes, dont une qui
 * represente la moitie ».
 */
export const groupeEchecSchema = z.object({
  signature: z.string(),
  /** Un message reel du groupe, pour que la signature reste reconnaissable. */
  exemple: z.string(),
  /** Une execution du groupe, pour y aller directement. */
  exempleExecutionId: z.uuid(),
  /**
   * Les bots touches par cette cause, du plus atteint au moins atteint.
   *
   * Le regroupement se fait **par cause seule**, pas par cause et par bot. Une
   * premiere version separait les deux, et le meme delai d'attente apparaissait
   * alors une fois par bot : « 12 fois Bonjour », « 5 fois Bavard ». C'est la
   * fragmentation que la signature existe justement pour eviter, reintroduite un
   * cran plus loin -- avec dix bots, la meme panne aurait rempli la liste a elle
   * seule. Le compte porte donc sur la cause, et les bots la situent.
   */
  bots: z.array(
    z.object({
      botId: z.string(),
      botName: z.string(),
      total: z.number().int().nonnegative(),
    }),
  ),
  total: z.number().int().nonnegative(),
  /** Depuis quand : c'est la moitie de la question que ce jalon doit repondre. */
  premierVu: z.coerce.date(),
  dernierVu: z.coerce.date(),
});
export type GroupeEchec = z.infer<typeof groupeEchecSchema>;

/** Tout ce que l'ecran de pilotage affiche, en un seul appel. */
export const pilotageSchema = z.object({
  jours: z.number().int().positive(),
  apercu: apercuStatsSchema,
  tendance: z.array(jourStatsSchema),
  bots: z.array(botStatsSchema),
  echecs: z.array(groupeEchecSchema),
});
export type Pilotage = z.infer<typeof pilotageSchema>;
