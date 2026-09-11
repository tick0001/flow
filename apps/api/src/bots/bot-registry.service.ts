import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { botManifestSchema, type BotManifest } from '@flow/contracts';
import { appRoot, loadEnv } from '../config/env.js';

/**
 * Ce qu'un dossier de depot peut contenir sans etre un depot.
 *
 * `node_modules` s'y trouve des qu'une installation en conteneur pose le lien
 * qui rend le SDK resoluble. Le scanner produirait un depot refuse, avec un
 * motif exact et parfaitement inutile : « aucun manifeste ». Les dossiers
 * caches sont ecartes pour la meme raison -- `.git`, `.DS_Store`.
 */
const IGNORES = new Set(['node_modules']);

function estUnDepot(nom: string): boolean {
  return !nom.startsWith('.') && !IGNORES.has(nom);
}

/** Un bot decouvert, charge ou refuse. */
export interface RegisteredBot {
  manifest: BotManifest;
  /** Dossier du bot, d'ou le worker importera son module. */
  directory: string;
  loaded: boolean;
  loadError: string | null;
}

/**
 * Version majeure du SDK que cette installation sait servir.
 *
 * Reprise du SDK plutot qu'importee : l'API ne depend pas de `@flow/bot-sdk`,
 * qui tire Playwright dans ses types. La valeur est verifiee par un test, pour
 * que la duplication ne devienne pas une divergence.
 */
export const SDK_MAJOR_SERVI = 1;

/**
 * Le registre des bots deposes.
 *
 * **L'API ne lit que des fichiers JSON.** Elle n'importe jamais le module d'un
 * bot : deposer un bot revient a executer son auteur, et rien n'oblige a le
 * faire dans le processus qui detient les identifiants de la base. Le manifeste
 * est produit a la construction, sur la machine de l'auteur, par `flow-bot
 * manifeste` ; seul le worker importera le code, et seulement pour l'executer.
 *
 * C'est l'ecart le plus net avec l'outil remplace, qui chargeait chaque DLL dans
 * le processus web -- avec les contextes d'assembly, la resolution de
 * dependances et le ramasse-miettes force que cela demandait.
 *
 * Pas de surveillance de dossier non plus. Plusieurs workers rechargeraient
 * chacun a son rythme, et une execution en cours verrait son module disparaitre
 * sous elle. Le rechargement se demande.
 */
@Injectable()
export class BotRegistryService implements OnModuleInit {
  private readonly logger = new Logger(BotRegistryService.name);
  private readonly bots = new Map<string, RegisteredBot>();

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  all(): RegisteredBot[] {
    return [...this.bots.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  get(botId: string): RegisteredBot | undefined {
    return this.bots.get(botId);
  }

  /** Dossier scanne. Absolu, ancre sur la racine du depot si le reglage est relatif. */
  directory(): string {
    const configure = loadEnv().BOTS_PATH;

    return resolve(appRoot(), configure);
  }

  /**
   * Relit le dossier des bots.
   *
   * Un bot refuse reste **visible** dans le registre, avec son motif : un bot
   * qui disparait sans explication envoie chercher dans les journaux du
   * conteneur, alors que la reponse tient en une ligne a l'ecran.
   */
  async reload(): Promise<RegisteredBot[]> {
    const dossier = this.directory();

    this.bots.clear();

    let entrees: string[];

    try {
      entrees = (await readdir(dossier, { withFileTypes: true }))
        .filter((entree) => entree.isDirectory() && estUnDepot(entree.name))
        .map((entree) => entree.name);
    } catch {
      // Dossier absent : une installation sans aucun bot est un etat normal,
      // pas une panne. Elle le reste jusqu'a ce qu'on en depose un.
      this.logger.log(`Aucun dossier de bots en ${dossier}.`);

      return [];
    }

    for (const nom of entrees) {
      const chemin = join(dossier, nom);
      const decouvert = await this.lire(chemin);

      if (!decouvert) continue;

      const existant = this.bots.get(decouvert.manifest.id);

      if (existant) {
        // Deux dossiers pour un meme identifiant : celui qui gagne dependrait de
        // l'ordre du systeme de fichiers, donc du hasard. On garde le premier et
        // on le dit.
        this.logger.warn(
          `Identifiant en double : ${decouvert.manifest.id} (${chemin}), deja fourni par ${existant.directory}. Ignore.`,
        );

        continue;
      }

      this.bots.set(decouvert.manifest.id, decouvert);
    }

    this.logger.log(`${String(this.bots.size)} bot(s) dans ${dossier}.`);

    return this.all();
  }

  /**
   * Lit le manifeste d'un dossier de bot.
   *
   * Deux emplacements acceptes : `flow.bot.json` a la racine du dossier -- ce que
   * produit un depot -- et `dist/flow.bot.json`, ou il atterrit quand le bot est
   * construit sur place. Le second existe pour que le depot de Flow& puisse
   * heberger son bot de reference sans etape de copie ; une installation reelle
   * n'utilise que le premier.
   */
  private async lire(chemin: string): Promise<RegisteredBot | null> {
    for (const candidat of [join(chemin, 'flow.bot.json'), join(chemin, 'dist', 'flow.bot.json')]) {
      let brut: string;

      try {
        brut = await readFile(candidat, 'utf8');
      } catch {
        continue;
      }

      return this.valider(chemin, brut);
    }

    // Un dossier sans manifeste n'est pas un bot : un `node_modules` egare, un
    // dossier de sources. Le signaler en avertissement remplirait les journaux.
    return null;
  }

  private valider(chemin: string, brut: string): RegisteredBot {
    let manifest: BotManifest;

    try {
      manifest = botManifestSchema.parse(JSON.parse(brut));
    } catch (erreur: unknown) {
      this.logger.error(`Manifeste invalide dans ${chemin} : ${String(erreur)}`);

      // Sans identifiant exploitable, le bot ne peut pas figurer au registre --
      // il n'a pas de clef. Le journal est le seul endroit ou le dire.
      return {
        manifest: {
          id: chemin,
          name: chemin,
          description: '',
          version: '0.0.0',
          author: '',
          tags: [],
          parameters: {},
          sdk: 0,
        },
        directory: chemin,
        loaded: false,
        loadError: 'Manifeste illisible ou invalide.',
      };
    }

    if (manifest.sdk !== SDK_MAJOR_SERVI) {
      return {
        manifest,
        directory: chemin,
        loaded: false,
        loadError: `Ce bot est ecrit pour la version ${String(manifest.sdk)} du SDK ; cette installation sert la version ${String(SDK_MAJOR_SERVI)}.`,
      };
    }

    return { manifest, directory: chemin, loaded: true, loadError: null };
  }
}
