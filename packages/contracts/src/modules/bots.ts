import { z } from 'zod';

/**
 * Etiquettes libres plutot qu'un enumere de categories.
 *
 * BotManager figeait neuf categories dans le coeur -- dont `Social` et
 * `ECommerce`, aussi specifiques qu'arbitraires. Un auteur de bot qui n'y
 * trouvait pas sa place prenait `Other`, et personne ne pouvait en ajouter une
 * sans une version du coeur. Des etiquettes libres se filtrent aussi bien et ne
 * demandent la permission de personne.
 */
export const botTagSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, 'minuscules, chiffres et tirets uniquement');

/**
 * Manifeste d'un bot, tel qu'il traverse les frontieres de processus.
 *
 * Les parametres sont decrits en **JSON Schema** et non en schema Zod : un
 * schema Zod ne se serialise pas, et le manifeste doit voyager du worker qui l'a
 * charge jusqu'au navigateur qui affiche le formulaire. L'auteur du bot n'ecrit
 * pourtant qu'un schema Zod -- le SDK en derive le JSON Schema a la
 * construction. Une seule source de verite, donc, et le serveur valide avec
 * exactement ce que l'interface a affiche.
 */
export const botManifestSchema = z.object({
  /**
   * Identifiant stable, choisi par l'auteur et jamais reattribue.
   *
   * En notation pointee plutot qu'en UUID -- ce que faisait BotManager : un
   * identifiant lisible se retrouve dans un journal, une clef de droit ou une
   * planification sans avoir a le resoudre.
   */
  id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'minuscules, chiffres, points et tirets'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'version semver'),
  author: z.string().max(120).default(''),
  tags: z.array(botTagSchema).max(10).default([]),

  /** JSON Schema des parametres, derive du schema Zod du bot par le SDK. */
  parameters: z.record(z.string(), z.unknown()),

  /**
   * Version majeure du SDK contre laquelle le bot est ecrit.
   *
   * Verifiee au chargement. Un bot compile contre une majeure que le worker ne
   * sait plus servir est refuse avec ce motif, plutot que charge et casse a la
   * premiere ligne de son execution.
   */
  sdk: z.number().int().positive(),
});
export type BotManifest = z.infer<typeof botManifestSchema>;

/**
 * Un bot tel que l'API le sert : son manifeste, son etat de chargement, et ce
 * que le demandeur a le droit d'en faire.
 *
 * Les capacites sont **calculees par le serveur** pour le compte qui interroge.
 * L'interface n'a donc jamais a recalculer un droit pour decider d'afficher un
 * bouton, et ne peut pas se tromper differemment du serveur. Ce n'est pas un
 * controle d'acces : chaque appel est revalide de toute facon.
 *
 * Trois booleens plutot qu'un niveau ordonne. BotManager avait une echelle
 * (aucun < voir < executer < gerer) qui supposait que les capacites
 * s'emboitent -- alors qu'un compte peut tres bien configurer un bot sans avoir
 * a le lancer.
 */
export const botSummarySchema = z.object({
  manifest: botManifestSchema,
  /** Le module a-t-il ete charge, ou son manifeste refuse ? */
  loaded: z.boolean(),
  /** Motif du refus quand `loaded` est faux -- manifeste invalide, version de SDK. */
  loadError: z.string().nullable(),
  canExecute: z.boolean(),
  canManage: z.boolean(),
});
export type BotSummary = z.infer<typeof botSummarySchema>;

/**
 * Demande de lancement.
 *
 * Les parametres arrivent en objet libre : ils sont valides par le schema du bot
 * vise, que le coeur ne connait pas a l'avance. La validation a lieu avant la
 * mise en file, pour qu'un parametre fautif soit un refus immediat et non une
 * execution qui echoue trente secondes plus tard.
 */
export const startExecutionSchema = z.object({
  botId: z.string().min(3).max(64),
  parameters: z.record(z.string(), z.unknown()).default({}),
  /**
   * Navigateur visible. Coute une diffusion d'images et un contexte plus lourd,
   * donc jamais par defaut : c'est un mode de mise au point.
   */
  headed: z.boolean().default(false),
});
export type StartExecution = z.infer<typeof startExecutionSchema>;
