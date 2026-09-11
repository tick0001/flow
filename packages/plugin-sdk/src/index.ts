import {
  pluginManifestSchema,
  type PluginEvent,
  type PluginHook,
  type PluginManifest,
  type PluginRight,
  type PluginSurface,
} from '@flow/contracts';

/**
 * Version majeure de la surface d'extension.
 *
 * Portee par le manifeste et verifiee **avant** le chargement du module. Un
 * plugin ecrit contre une majeure que cette installation ne sert plus est refuse
 * avec ce motif, plutot qu'importe et casse au premier appel -- ou, pire,
 * execute avec un contexte dont un champ a change de sens.
 */
export const SDK_MAJOR = 1;

/** Niveaux du journal, alignes sur ceux des executions. */
export type NiveauJournal = 'debug' | 'info' | 'warn' | 'error';

/**
 * Qui agit, et ou.
 *
 * Nul pour une tache de fond : personne ne l'a demandee. Un plugin qui a besoin
 * d'un acteur pour travailler doit donc le dire plutot que de supposer.
 */
export interface Acteur {
  userId: number;
  profileId: number;
  entityPath: string;
}

/**
 * Ce qu'un plugin recoit a chaque appel.
 *
 * `requete` passe par le **role applicatif**, avec les parametres de session du
 * contexte courant : les politiques de Row-Level Security s'appliquent aux
 * tables du plugin comme a celles du coeur, pourvu qu'il en ait declare. Le
 * `search_path` pointe sur son schema puis sur `public`, si bien que ses tables
 * se nomment sans prefixe et que celles du coeur restent lisibles.
 *
 * Les valeurs sont **liees**, jamais concatenees : `$1`, `$2`, comme le veut le
 * pilote PostgreSQL. C'est la seule forme offerte, et c'est delibere -- une
 * fonction qui aurait pris du SQL deja assemble aurait fait de chaque plugin une
 * injection possible dans la base de quelqu'un d'autre.
 */
export interface ContextePlugin {
  log: (niveau: NiveauJournal, message: string) => void;
  requete: <L extends Record<string, unknown> = Record<string, unknown>>(
    texte: string,
    valeurs?: readonly unknown[],
  ) => Promise<L[]>;
  acteur: Acteur | null;
}

/**
 * Refus explicite d'un plugin.
 *
 * Levee depuis un hook, elle annule l'operation et **son message parvient a
 * l'utilisateur**. Toute autre exception annule aussi l'operation, mais est
 * presentee comme une panne du plugin : la distinction dit a qui s'adresser.
 */
export class RefusPlugin extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusPlugin';
  }
}

/** Ce qu'un hook de lancement recoit. Le plugin peut refuser, pas reecrire. */
export interface ChargeAvantLancement {
  botId: string;
  botName: string;
  parameters: Record<string, unknown>;
  entityPath: string;
  userId: number;
}

/** Une execution vient de partir. */
export interface ChargeExecutionLancee {
  executionId: string;
  botId: string;
  entityPath: string;
  userId: number;
}

/** Une execution s'est terminee, quelle qu'en soit l'issue. */
export interface ChargeExecutionTerminee extends ChargeExecutionLancee {
  status: string;
  durationMs: number | null;
  message: string | null;
}

/**
 * Les hooks, par point d'accroche.
 *
 * Chaque entree accepte explicitement `undefined` : un plugin qui n'accroche
 * son hook que sous condition ecrit `condition ? maFonction : undefined`, et
 * le manifeste derive ne declarera alors rien. L'interdire obligerait a
 * construire l'objet par morceaux pour un cas courant.
 */
export interface HooksDuPlugin {
  'execution.avant-lancement'?:
    ((contexte: ContextePlugin, charge: ChargeAvantLancement) => Promise<void> | void) | undefined;
}

/** Les abonnements aux evenements, par nom. */
export interface EvenementsDuPlugin {
  'execution.lancee'?:
    ((contexte: ContextePlugin, charge: ChargeExecutionLancee) => Promise<void> | void) | undefined;
  'execution.terminee'?:
    | ((contexte: ContextePlugin, charge: ChargeExecutionTerminee) => Promise<void> | void)
    | undefined;
}

/** Une tache de fond : sa periode, et ce qu'elle fait. */
export interface TacheDuPlugin {
  id: string;
  intervalSeconds: number;
  run: (contexte: ContextePlugin) => Promise<void> | void;
}

/**
 * Un plugin, tel que son auteur le declare.
 *
 * Tout y est facultatif sauf l'identite : un plugin qui ne remplit qu'un
 * emplacement d'interface n'a ni table, ni droit, ni hook a declarer.
 */
export interface DefinitionPlugin {
  id: string;
  name: string;
  description?: string | undefined;
  version: string;
  author?: string | undefined;

  /**
   * Le plugin demande-t-il un schema PostgreSQL ?
   *
   * Ses migrations vivent dans `migrations/`, sont jouees a l'installation dans
   * l'ordre de leurs noms, et son schema entier est supprime a la
   * desinstallation.
   */
  schema?: boolean | undefined;

  rights?: PluginRight[] | undefined;
  surfaces?: PluginSurface[] | undefined;
  tasks?: TacheDuPlugin[] | undefined;
  hooks?: HooksDuPlugin | undefined;
  events?: EvenementsDuPlugin | undefined;
}

/** Un plugin construit, tel que l'API le charge. */
export interface Plugin extends DefinitionPlugin {
  readonly sdk: number;
}

/**
 * Declare un plugin.
 *
 * Ne fait presque rien, et c'est voulu : elle epingle le type et pose la version
 * de la surface d'extension. Toute la valeur est dans le typage -- un hook dont
 * la charge a change de forme cesse de compiler chez l'auteur, avant d'echouer
 * chez l'exploitant.
 */
export function definirPlugin(definition: DefinitionPlugin): Plugin {
  return { ...definition, sdk: SDK_MAJOR };
}

/**
 * Derive le manifeste d'un plugin.
 *
 * Appelee par l'outil `flow-plugin`, **a la construction**. L'API lit ce fichier
 * avant d'importer quoi que ce soit : c'est ce qui lui permet de refuser un
 * plugin incompatible sans jamais executer une de ses lignes.
 *
 * Les hooks et les evenements ne sont pas redeclares : ils sont **deduits des
 * fonctions reellement fournies**. Deux listes -- celle du manifeste et celle du
 * code -- auraient fini par ne plus s'accorder, et un hook declare mais absent
 * se serait vu attendre par l'API a chaque lancement.
 */
export function toManifest(plugin: Plugin, module: string): PluginManifest {
  const hooks = Object.entries(plugin.hooks ?? {})
    .filter(([, fonction]) => typeof fonction === 'function')
    .map(([nom]) => nom as PluginHook);

  const events = Object.entries(plugin.events ?? {})
    .filter(([, fonction]) => typeof fonction === 'function')
    .map(([nom]) => nom as PluginEvent);

  return pluginManifestSchema.parse({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description ?? '',
    version: plugin.version,
    author: plugin.author ?? '',
    sdk: plugin.sdk,
    module,
    schema: plugin.schema ?? false,
    rights: plugin.rights ?? [],
    hooks,
    events,
    surfaces: plugin.surfaces ?? [],
    tasks: (plugin.tasks ?? []).map((tache) => ({
      id: tache.id,
      intervalSeconds: tache.intervalSeconds,
    })),
  });
}

export {
  pluginManifestSchema,
  schemaDuPlugin,
  type PluginEvent,
  type PluginHook,
  type PluginManifest,
  type PluginRight,
  type PluginSlot,
  type PluginSurface,
} from '@flow/contracts';
