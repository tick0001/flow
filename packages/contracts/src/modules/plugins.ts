import { z } from 'zod';
import { localeSchema, rightScopeSchema } from './common.js';

/**
 * Identifiant d'un plugin.
 *
 * Meme forme que celle d'un bot -- lisible, stable, jamais reattribuee -- avec
 * une contrainte de plus : il devient un **nom de schema PostgreSQL**, prefixe
 * de `plugin_`, les tirets et les points changes en soulignes. D'ou la longueur
 * bornee a quarante-huit caracteres, les identifiants PostgreSQL etant tronques
 * a soixante-trois.
 */
export const pluginIdSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'minuscules, chiffres, points et tirets');

/**
 * Le nom du schema PostgreSQL d'un plugin, deduit de son identifiant.
 *
 * Ecrit ici plutot que dans l'API : l'installateur le calcule pour creer le
 * schema, la desinstallation pour le supprimer, et les tests pour verifier
 * qu'il ne reste rien. Trois endroits, une seule regle.
 */
export function schemaDuPlugin(id: string): string {
  return `plugin_${id.replace(/[.-]/g, '_')}`;
}

/**
 * Un libelle dans les deux langues.
 *
 * Un plugin ne peut pas ajouter de clefs aux dictionnaires du coeur : ils sont
 * compiles dans le paquet de l'interface. Il porte donc ses libelles lui-meme,
 * et l'interface les prefere a la clef de traduction quand ils sont la.
 */
export const libelleSchema = z.record(localeSchema, z.string().min(1).max(120));
export type Libelle = z.infer<typeof libelleSchema>;

/**
 * Un droit declare par un plugin.
 *
 * Meme forme que ceux du coeur, aux libelles pres. L'objet est **prefixe de
 * l'identifiant du plugin** a l'enregistrement, faute de quoi deux plugins qui
 * declareraient tous deux `note:read` se marcheraient dessus -- et la
 * desinstallation de l'un retirerait les droits de l'autre.
 */
export const pluginRightSchema = z.object({
  object: z.string().min(1).max(32),
  action: z.string().min(1).max(32),
  scopes: z.array(rightScopeSchema).min(1),
  label: libelleSchema,
});
export type PluginRight = z.infer<typeof pluginRightSchema>;

/**
 * Les emplacements d'interface qu'un plugin peut remplir.
 *
 * Une liste fermee, et c'est delibere : un emplacement est un contrat -- une
 * position dans une page et un contexte passe au rendu. Laisser un plugin
 * inventer le sien reviendrait a lui laisser choisir ou il s'affiche, et le
 * jour ou la page change, rien ne dirait ce qui casse.
 */
export const pluginSlotSchema = z.enum(['execution.detail', 'pilotage.encart']);
export type PluginSlot = z.infer<typeof pluginSlotSchema>;

/** Un emplacement rempli : l'endroit, et le module qui sait le dessiner. */
export const pluginSurfaceSchema = z.object({
  slot: pluginSlotSchema,
  /** Fichier du paquet d'interface, relatif au dossier du plugin. */
  entry: z.string().min(1).max(200),
});
export type PluginSurface = z.infer<typeof pluginSurfaceSchema>;

/**
 * Les points d'accroche synchrones.
 *
 * Un hook s'execute **dans le chemin de l'operation** et peut la refuser. Il est
 * attendu, il est borne dans le temps, et une exception y annule l'operation --
 * c'est ce qui le distingue d'un evenement.
 *
 * La liste est courte, et le restera tant qu'un besoin reel ne l'allonge pas :
 * chaque point d'accroche est une promesse de compatibilite.
 */
export const pluginHookSchema = z.enum(['execution.avant-lancement']);
export type PluginHook = z.infer<typeof pluginHookSchema>;

/**
 * Les evenements, apres coup.
 *
 * Diffuses sans etre attendus : une erreur y est journalisee et ne remonte
 * jamais a l'operation qui les a produits. Un plugin qui casse en traitant une
 * fin d'execution ne fait pas echouer l'execution.
 */
export const pluginEventSchema = z.enum(['execution.lancee', 'execution.terminee']);
export type PluginEvent = z.infer<typeof pluginEventSchema>;

/** Une tache de fond declaree par un plugin. */
export const pluginTaskSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'minuscules, chiffres et tirets'),
  /**
   * Periode, en secondes. Au moins une minute.
   *
   * Une tache de plugin partage le processus de l'API : la laisser tourner
   * toutes les secondes reviendrait a laisser un plugin decider de la charge du
   * serveur.
   */
  intervalSeconds: z.number().int().min(60).max(86_400),
});
export type PluginTask = z.infer<typeof pluginTaskSchema>;

/**
 * Manifeste d'un plugin.
 *
 * **Lu avant que la moindre ligne du plugin ne soit importee.** Un manifeste
 * illisible, ou qui vise une majeure que cette installation ne sert plus, est
 * refuse sans que le module ne soit charge. C'est la seule protection reelle du
 * dispositif, et elle est modeste : un plugin installe s'execute ensuite dans le
 * processus de l'API, avec ses privileges. Installer un plugin engage autant que
 * deployer l'application.
 */
export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'version semver'),
  author: z.string().max(120).default(''),

  /**
   * Version majeure de la surface d'extension contre laquelle le plugin est
   * ecrit. Verifiee avant le chargement, comme celle d'un bot.
   */
  sdk: z.number().int().positive(),

  /** Module a importer, relatif au dossier du plugin. */
  module: z.string().min(1).max(200),

  /**
   * Le plugin demande-t-il un schema PostgreSQL ?
   *
   * Quand il le demande, le schema est cree a l'installation et ses migrations
   * sont jouees ; il est **supprime en entier** a la desinstallation. Un plugin
   * qui n'ecrit rien ne le demande pas, et ne laisse alors rien a supprimer.
   */
  schema: z.boolean().default(false),

  rights: z.array(pluginRightSchema).max(32).default([]),
  hooks: z.array(pluginHookSchema).max(16).default([]),
  events: z.array(pluginEventSchema).max(16).default([]),
  surfaces: z.array(pluginSurfaceSchema).max(16).default([]),
  tasks: z.array(pluginTaskSchema).max(8).default([]),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Ou en est un plugin.
 *
 * `orphelin` est le seul etat qui ne se choisit pas : il decrit un plugin
 * installe dont le dossier a disparu. Son schema, ses droits et sa ligne sont
 * pourtant toujours la. Le taire laisserait des tables et des droits derriere
 * un plugin que plus rien ne montre ; l'afficher permet de le desinstaller pour
 * de bon.
 */
export const pluginStateSchema = z.enum(['disponible', 'actif', 'inactif', 'refuse', 'orphelin']);
export type PluginState = z.infer<typeof pluginStateSchema>;

/** Un plugin tel que l'ecran d'administration le montre. */
export const pluginSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Version presente sur le disque, absente pour un orphelin. */
  version: z.string().nullable(),
  /** Version installee en base, absente pour un plugin seulement decouvert. */
  installedVersion: z.string().nullable(),
  author: z.string(),
  state: pluginStateSchema,
  /** Motif du refus, ou de l'orphelinat. */
  reason: z.string().nullable(),
  schema: z.boolean(),
  rights: z.array(pluginRightSchema),
  hooks: z.array(pluginHookSchema),
  events: z.array(pluginEventSchema),
  surfaces: z.array(pluginSurfaceSchema),
  tasks: z.array(pluginTaskSchema),
});
export type PluginSummary = z.infer<typeof pluginSummarySchema>;

/**
 * Ce que l'interface a besoin de savoir pour remplir un emplacement.
 *
 * L'adresse du module est **servie par l'API** et non devinee : le fichier vit
 * dans le dossier du plugin, que rien ne publie statiquement.
 */
export const pluginAssetSchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  slot: pluginSlotSchema,
  url: z.string(),
});
export type PluginAsset = z.infer<typeof pluginAssetSchema>;
