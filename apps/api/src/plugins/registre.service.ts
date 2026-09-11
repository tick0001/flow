import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { pluginManifestSchema, type PluginManifest } from '@flow/contracts';
import { appRoot, loadEnv } from '../config/env.js';

/**
 * Version majeure de la surface d'extension que cette installation sert.
 *
 * Reprise du SDK plutot qu'importee -- comme celle des bots -- pour que l'API ne
 * depende pas du paquet au chargement. Un test verifie que les deux valeurs
 * n'ont pas diverge.
 */
export const SDK_MAJOR_SERVI = 1;

/** Nom du manifeste, a la racine du dossier d'un plugin. */
export const NOM_MANIFESTE = 'flow.plugin.json';

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

/** Un plugin trouve sur le disque : accepte, ou refuse avec son motif. */
export interface PluginDecouvert {
  /** Identifiant : celui du manifeste, ou a defaut le nom du dossier. */
  id: string;
  manifest: PluginManifest | null;
  directory: string;
  reason: string | null;
}

/**
 * Ce qui est pose sur le disque.
 *
 * **Aucun module n'est importe ici.** Le registre lit des fichiers JSON, les
 * valide, et refuse ce qui ne tient pas debout -- un manifeste illisible, une
 * majeure inconnue, deux plugins qui se disputent un identifiant. C'est la seule
 * verification que l'application puisse faire de l'exterieur : une fois le
 * module charge, le plugin est dans le processus, et plus rien ne l'en separe.
 *
 * Le chargement proprement dit appartient a l'installateur, et ne concerne que
 * les plugins installes et actifs. Un plugin depose mais jamais installe n'est
 * donc jamais execute -- ce qui est exactement la difference entre « poser un
 * fichier sur un serveur » et « installer une extension ».
 */
@Injectable()
export class PluginRegistryService {
  private readonly logger = new Logger(PluginRegistryService.name);
  private readonly decouverts = new Map<string, PluginDecouvert>();

  /** Dossier scanne. Absolu, ancre sur la racine du depot si le reglage est relatif. */
  directory(): string {
    return resolve(appRoot(), loadEnv().PLUGINS_PATH);
  }

  all(): PluginDecouvert[] {
    return [...this.decouverts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): PluginDecouvert | undefined {
    return this.decouverts.get(id);
  }

  /**
   * Relit le dossier des plugins.
   *
   * Un plugin refuse reste **visible**, avec son motif. Un plugin qui disparait
   * sans explication envoie chercher dans les journaux du conteneur, alors que
   * la reponse tient en une ligne a l'ecran.
   */
  async relire(): Promise<PluginDecouvert[]> {
    const dossier = this.directory();

    this.decouverts.clear();

    let entrees: string[];

    try {
      entrees = await readdir(dossier);
    } catch {
      this.logger.log(`Aucun dossier de plugins en ${dossier}.`);

      return [];
    }

    for (const entree of entrees.sort()) {
      if (!estUnDepot(entree)) continue;

      const chemin = join(dossier, entree);
      const decouvert = await this.lire(entree, chemin);

      const deja = this.decouverts.get(decouvert.id);

      if (deja) {
        // Deux dossiers pour un identifiant : refuser les deux serait pire --
        // on perdrait celui qui marchait. Le premier tient, le second le dit.
        this.logger.warn(
          `Identifiant en double : ${decouvert.id} (${chemin}), deja fourni par ${deja.directory}. Ignore.`,
        );

        continue;
      }

      this.decouverts.set(decouvert.id, decouvert);
    }

    const refuses = this.all().filter((plugin) => plugin.reason !== null).length;

    this.logger.log(
      `${String(this.decouverts.size)} plugin(s) dans ${dossier}${refuses > 0 ? `, dont ${String(refuses)} refuse(s)` : ''}.`,
    );

    return this.all();
  }

  private async lire(nomDuDossier: string, chemin: string): Promise<PluginDecouvert> {
    let brut: string;

    try {
      brut = await readFile(join(chemin, NOM_MANIFESTE), 'utf8');
    } catch {
      return {
        id: nomDuDossier,
        manifest: null,
        directory: chemin,
        reason: `Aucun ${NOM_MANIFESTE} : le manifeste se produit a la construction, par « flow-plugin manifeste ».`,
      };
    }

    let json: unknown;

    try {
      json = JSON.parse(brut);
    } catch (erreur: unknown) {
      return {
        id: nomDuDossier,
        manifest: null,
        directory: chemin,
        reason: `Manifeste illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      };
    }

    const lecture = pluginManifestSchema.safeParse(json);

    if (!lecture.success) {
      const premier = lecture.error.issues[0];

      return {
        id: nomDuDossier,
        manifest: null,
        directory: chemin,
        reason: `Manifeste invalide : ${premier ? `${premier.path.join('.')} — ${premier.message}` : 'forme inattendue'}`,
      };
    }

    const manifeste = lecture.data;

    if (manifeste.sdk !== SDK_MAJOR_SERVI) {
      // Refuse **avant** tout chargement, et c'est tout l'interet du manifeste :
      // un plugin ecrit contre une autre majeure serait sinon importe, puis
      // appele avec des charges dont les champs ont change de sens.
      return {
        id: manifeste.id,
        manifest: null,
        directory: chemin,
        reason: `Ecrit pour la surface d'extension ${String(manifeste.sdk)}, cette installation sert la ${String(SDK_MAJOR_SERVI)}.`,
      };
    }

    return { id: manifeste.id, manifest: manifeste, directory: chemin, reason: null };
  }
}
