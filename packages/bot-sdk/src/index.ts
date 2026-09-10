import { z } from 'zod';
import { botManifestSchema, type BotManifest, type LogLevel } from '@flow/contracts';
import type { Page } from 'playwright';

/**
 * Version majeure du SDK.
 *
 * Portee par le manifeste et verifiee au chargement. Un bot compile contre une
 * majeure que le worker ne sait plus servir est refuse avec ce motif, plutot que
 * charge et casse a la premiere ligne de son execution -- ou, pire, execute avec
 * un contexte dont un champ a change de sens.
 */
export const SDK_MAJOR = 1;

/**
 * Ce qu'un bot recoit pour travailler.
 *
 * `page` est une **vraie `Page` Playwright**, pas une facade. C'est le choix
 * central de Flow& : l'outil qu'il remplace interposait une interface de
 * soixante-dix methodes qui masquait les locators, l'attente automatique,
 * l'interception reseau et le tracing -- pour une interchangeabilite d'engine
 * qui n'a jamais servi.
 *
 * Le reste est ce que Playwright ne fournit pas : de quoi raconter ce qu'on
 * fait, et de quoi s'arreter quand on le demande.
 */
export interface BotContext<P> {
  /** Les parametres, deja valides par le schema du bot. */
  params: P;

  /** La page du contexte navigateur isole ouvert pour cette execution. */
  page: Page;

  /**
   * Journalise une ligne, persistee au fil de l'eau.
   *
   * Pas de `console.log` : la sortie standard du worker est partagee par toutes
   * les executions en cours, et personne ne pourrait dire laquelle a ecrit quoi.
   */
  log: (level: LogLevel, message: string) => void;

  /**
   * Dit ou l'on en est.
   *
   * Le pourcentage est facultatif : beaucoup de bots savent nommer leur etape
   * sans savoir combien il reste. Exiger un chiffre les pousserait a en inventer
   * un, et une barre qui recule est pire qu'une barre absente.
   */
  progress: (step: string, percent?: number) => void;

  /**
   * Annulation demandee.
   *
   * A passer aux attentes longues et a verifier entre deux etapes. Un bot qui
   * l'ignore sera de toute facon interrompu par la fermeture de son contexte
   * navigateur -- mais brutalement, sans pouvoir refermer proprement ce qu'il
   * avait ouvert.
   */
  signal: AbortSignal;

  /**
   * Dossier ou deposer ce qui doit survivre a l'execution : captures, exports.
   *
   * Ce qu'on y ecrit est verse au stockage de fichiers a la fin et rattache a la
   * trace. Ecrire ailleurs sur le disque du worker ne survit pas au conteneur.
   */
  outputDir: string;
}

/** Ce qu'un bot rend en terminant. */
export interface BotResult {
  /** Phrase de conclusion, affichee en tete de la trace. */
  message?: string;
  /**
   * Donnees metier produites. Stockees en `jsonb` et rendues telles quelles :
   * le coeur ne sait rien de leur forme, et n'a pas a le savoir.
   */
  output?: Record<string, unknown>;
}

/**
 * Un bot, tel que son auteur le declare.
 *
 * Le schema Zod est la **seule** description des parametres : il sert a valider a
 * l'execution, a typer `params` a la compilation, et le manifeste en derive le
 * JSON Schema qui dessine le formulaire. L'outil qu'il remplace avait un type
 * `BotParameter` avec un enumere de controles et une expression reguliere, soit
 * un langage de description de formulaire reinvente a cote du systeme de types --
 * les deux pouvaient se contredire.
 */
export interface BotDefinition<S extends z.ZodType> {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  tags?: string[];
  parameters: S;
  run: (context: BotContext<z.infer<S>>) => Promise<BotResult | void>;
}

/** Un bot construit, tel que le worker le charge. */
export interface Bot<S extends z.ZodType = z.ZodType> extends BotDefinition<S> {
  readonly sdk: number;
}

/**
 * Declare un bot.
 *
 * Ne fait presque rien, et c'est voulu : elle epingle le type et pose la version
 * du SDK. Toute la valeur est dans l'inference -- `run` recoit des parametres
 * types depuis le schema, sans que l'auteur ait a les redecrire.
 */
export function defineBot<S extends z.ZodType>(definition: BotDefinition<S>): Bot<S> {
  return { ...definition, sdk: SDK_MAJOR };
}

/**
 * Derive le manifeste d'un bot.
 *
 * Appelee par l'outil `flow-bot`, **sur la machine de l'auteur**, jamais par le
 * serveur. C'est ce qui permet a l'API de lire un fichier JSON au lieu
 * d'importer du code : deposer un bot revient a executer son auteur, et rien
 * n'oblige a le faire dans le processus qui detient les identifiants de la base.
 * Seul le worker importe le module, et seulement pour l'executer.
 *
 * `io: 'input'` : le formulaire decrit ce qu'on **saisit**, pas ce que le schema
 * produit. La difference compte des qu'un champ a une valeur par defaut ou une
 * transformation -- il serait autrement annonce obligatoire.
 */
export function toManifest(bot: Bot): BotManifest {
  const parameters = z.toJSONSchema(bot.parameters, { io: 'input' }) as Record<string, unknown>;

  return botManifestSchema.parse({
    id: bot.id,
    name: bot.name,
    description: bot.description ?? '',
    version: bot.version,
    author: bot.author ?? '',
    tags: bot.tags ?? [],
    parameters,
    sdk: bot.sdk,
  });
}

export { botManifestSchema, type BotManifest, type LogLevel };
export { z };
