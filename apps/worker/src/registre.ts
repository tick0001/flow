import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SDK_MAJOR, type Bot } from '@flow/bot-sdk';
import { botManifestSchema, type BotManifest } from '@flow/contracts';
import { loadEnv, resolveFromRoot } from './config/env.js';
import { journalDe } from './log.js';

const log = journalDe('Registre');

export interface BotCharge {
  bot: Bot;
  manifest: BotManifest;
}

interface EnCache extends BotCharge {
  /** Date de modification du module au moment du chargement. */
  empreinte: number;
}

/**
 * Le chargement des bots, cote worker.
 *
 * **Le worker est le seul processus qui importe le code d'un bot.** L'API ne lit
 * que des manifestes JSON : deposer un bot revient a executer son auteur, et rien
 * n'oblige a le faire dans le processus qui detient les identifiants de la base.
 *
 * Un `import()` ordinaire, et c'est tout. Ce que l'outil remplace demandait pour
 * le meme resultat : des `AssemblyLoadContext` isoles, la resolution des
 * dependances par `deps.json`, l'epinglage manuel des assemblies de contrat pour
 * que les types restent identiques de part et d'autre, des contextes collectibles
 * pour les bots et non collectibles pour les plugins, un `GC.Collect()` explicite
 * pour decharger, et un `FileSystemWatcher` temporise a 700 ms pour ne pas
 * recharger sept fois pendant une copie de fichiers.
 *
 * **Le chargement est paresseux, a l'execution, et non au demarrage.** Trois
 * consequences, et c'est pour elles que le mecanisme est celui-la :
 *
 *  - un bot depose pendant que le worker tourne est pris au prochain lancement,
 *    sans ordre de relecture a diffuser ni dossier a surveiller ;
 *  - un module qui a change depuis est **reimporte**, puisque l'empreinte ne
 *    correspond plus ;
 *  - un run en cours ne voit jamais son module changer sous lui, l'import ayant
 *    lieu avant que le bot ne demarre.
 *
 * Le prix du reimport est une entree de plus dans le cache de modules de Node,
 * que rien ne libere -- une fuite d'un module par version deposee. C'est le meme
 * prix qu'un ordre de relecture aurait coute, sans le mecanisme.
 */
export function dossierDesBots(): string {
  return resolveFromRoot(loadEnv().BOTS_PATH);
}

const cache = new Map<string, EnCache>();

/**
 * Charge un bot par son identifiant.
 *
 * Le dossier est retrouve en relisant les manifestes, et non par une convention
 * de nommage : l'identifiant d'un bot est choisi par son auteur (`monorg.titre`)
 * et n'a aucune raison de correspondre au nom du dossier ou il a ete depose.
 */
export async function chargerBot(botId: string): Promise<BotCharge> {
  const emplacement = await trouver(botId);

  if (!emplacement) {
    throw new Error(
      `Aucun bot « ${botId} » dans ${dossierDesBots()}. A-t-il ete retire depuis la mise en file ?`,
    );
  }

  const { manifest, module } = emplacement;

  if (manifest.sdk !== SDK_MAJOR) {
    throw new Error(
      `Ce bot est ecrit pour la version ${String(manifest.sdk)} du SDK ; ce worker sert la version ${String(SDK_MAJOR)}.`,
    );
  }

  const empreinte = (await stat(module)).mtimeMs;
  const enCache = cache.get(botId);

  if (enCache && enCache.empreinte === empreinte) return enCache;

  // Le parametre d'URL force Node a reimporter un module deja charge : son cache
  // est indexe par URL, et sans lui un bot mis a jour continuerait de tourner
  // dans sa version precedente jusqu'au redemarrage du worker.
  const url = `${pathToFileURL(module).href}?v=${String(empreinte)}`;
  const charge = (await import(url)) as { default?: unknown; bot?: unknown };
  const bot = charge.default ?? charge.bot;

  if (!estBot(bot)) {
    throw new Error(
      `${module} n'exporte pas de bot. Attendu : un export par defaut construit par defineBot().`,
    );
  }

  if (bot.id !== manifest.id) {
    // Le manifeste et le module se contredisent : le manifeste a ete produit
    // depuis un autre bot, ou copie a la main. Refuser ici evite d'executer un
    // bot sous le nom d'un autre -- ce qui rendrait une trace mensongere.
    throw new Error(
      `Le manifeste annonce « ${manifest.id} » et le module exporte « ${bot.id} ». Reconstruisez le bot.`,
    );
  }

  log.log(`Bot ${botId} charge depuis ${module}.`);

  const resultat: EnCache = { bot, manifest, empreinte };

  cache.set(botId, resultat);

  return resultat;
}

interface Emplacement {
  manifest: BotManifest;
  module: string;
}

async function trouver(botId: string): Promise<Emplacement | null> {
  const dossier = dossierDesBots();

  let entrees: string[];

  try {
    entrees = (await readdir(dossier, { withFileTypes: true }))
      .filter((entree) => entree.isDirectory())
      .map((entree) => entree.name);
  } catch {
    return null;
  }

  for (const nom of entrees) {
    const chemin = join(dossier, nom);

    for (const racine of [chemin, join(chemin, 'dist')]) {
      const manifest = await lireManifeste(join(racine, 'flow.bot.json'));

      if (!manifest || manifest.id !== botId) continue;

      // Le manifeste vit a cote du module qu'il decrit : `flow-bot manifeste`
      // l'ecrit par defaut dans le dossier du module construit.
      return { manifest, module: join(racine, 'index.js') };
    }
  }

  return null;
}

async function lireManifeste(chemin: string): Promise<BotManifest | null> {
  try {
    return botManifestSchema.parse(JSON.parse(await readFile(chemin, 'utf8')));
  } catch {
    // Manifeste absent ou invalide : ce n'est pas le bot qu'on cherche, et c'est
    // l'API qui a la charge de le signaler au catalogue -- le repeter ici
    // remplirait les journaux du worker a chaque lancement.
    return null;
  }
}

function estBot(valeur: unknown): valeur is Bot {
  if (typeof valeur !== 'object' || valeur === null) return false;

  const candidat = valeur as Partial<Bot>;

  return (
    typeof candidat.id === 'string' &&
    typeof candidat.run === 'function' &&
    typeof candidat.sdk === 'number' &&
    candidat.parameters !== undefined
  );
}

/** Vide le cache des modules charges. Reserve aux tests. */
export function resetRegistre(): void {
  cache.clear();
}
