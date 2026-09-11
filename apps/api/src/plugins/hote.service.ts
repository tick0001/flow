import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable, Logger } from '@nestjs/common';
import { schemaDuPlugin, type PluginManifest, type RightDefinition } from '@flow/contracts';
import type { Plugin, TacheDuPlugin } from '@flow/plugin-sdk';
import { RightsCatalogService } from '../admin/rights-catalog.service.js';
import type { PluginDecouvert } from './registre.service.js';

/** Un plugin charge, avec de quoi l'appeler. */
export interface PluginCharge {
  manifest: PluginManifest;
  directory: string;
  schema: string | null;
  instance: Plugin;
}

/**
 * Prefixe l'objet d'un droit de plugin par l'identifiant du plugin.
 *
 * Sans cela, deux plugins qui declarent chacun `note:read` se partagent le meme
 * droit : accorder celui de l'un accorde celui de l'autre, et desinstaller l'un
 * retire les droits de l'autre. Le prefixe rend aussi la desinstallation
 * possible sans tenir de liste -- tout ce qui commence par `<id>.` s'en va.
 */
export function objetDuDroit(pluginId: string, objet: string): string {
  return `${pluginId}.${objet}`;
}

/**
 * Les plugins effectivement charges dans ce processus.
 *
 * **C'est ici que le dispositif cesse d'etre isole.** Jusqu'au manifeste, tout
 * se verifie de l'exterieur ; a partir de l'`import()`, le plugin est dans le
 * processus de l'API, partage son tas, ses privileges et sa connexion a la base.
 * Il n'y a pas de bac a sable, et ce jalon n'en promet pas : un plugin
 * s'installe comme on deploie une version, par quelqu'un qui repond de ce qu'il
 * pose.
 *
 * Ce qui est tenu, en revanche : rien n'est importe qui ne soit **installe et
 * actif**. Un dossier depose sur le serveur ne s'execute pas parce qu'il est la.
 */
@Injectable()
export class PluginHostService {
  private readonly logger = new Logger(PluginHostService.name);
  private readonly charges = new Map<string, PluginCharge>();

  constructor(private readonly catalogue: RightsCatalogService) {}

  all(): PluginCharge[] {
    return [...this.charges.values()];
  }

  get(id: string): PluginCharge | undefined {
    return this.charges.get(id);
  }

  estCharge(id: string): boolean {
    return this.charges.has(id);
  }

  /**
   * Importe le module d'un plugin et enregistre ses droits.
   *
   * L'adresse porte la version et la date du fichier : Node met en cache par
   * URL, et un plugin mis a jour sans redemarrage rendrait sinon l'ancien
   * module. Le prix est une entree de plus dans le cache a chaque version -- le
   * meme prix que paie le worker pour les bots, et pour la meme raison.
   */
  async charger(decouvert: PluginDecouvert): Promise<PluginCharge> {
    const manifeste = decouvert.manifest;

    if (!manifeste) {
      throw new Error(decouvert.reason ?? 'Plugin sans manifeste valide.');
    }

    const chemin = resolve(decouvert.directory, manifeste.module);
    const empreinte = await stat(chemin)
      .then((infos) => String(infos.mtimeMs))
      .catch(() => '0');

    const module = (await import(
      `${pathToFileURL(chemin).href}?v=${encodeURIComponent(manifeste.version)}&t=${empreinte}`
    )) as { default?: unknown; plugin?: unknown };

    const instance = (module.default ?? module.plugin) as Plugin | undefined;

    if (!instance || typeof instance !== 'object' || instance.id !== manifeste.id) {
      throw new Error(
        `${manifeste.module} n'exporte pas le plugin ${manifeste.id} annonce par son manifeste.`,
      );
    }

    const charge: PluginCharge = {
      manifest: manifeste,
      directory: decouvert.directory,
      schema: manifeste.schema ? schemaDuPlugin(manifeste.id) : null,
      instance,
    };

    this.charges.set(manifeste.id, charge);
    this.catalogue.register(manifeste.id, this.droitsDe(manifeste));
    this.logger.log(`${manifeste.id} ${manifeste.version} charge.`);

    return charge;
  }

  /**
   * Oublie un plugin : ses hooks, ses evenements, ses taches, ses droits.
   *
   * Le module reste dans le cache de Node -- rien ne permet de l'en sortir --,
   * mais plus rien ne l'appelle. C'est la difference entre desactiver et
   * desinstaller : ici on cesse d'appeler, la-bas on efface ce qu'il a ecrit.
   */
  decharger(id: string): void {
    if (!this.charges.delete(id)) return;

    this.catalogue.unregister(id);
    this.logger.log(`${id} decharge.`);
  }

  /** Les plugins qui accrochent ce point, dans un ordre stable. */
  pourHook(nom: 'execution.avant-lancement' | 'authentification.verifier'): PluginCharge[] {
    return this.all()
      .filter((charge) => typeof charge.instance.hooks?.[nom] === 'function')
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }

  /** Les plugins abonnes a cet evenement. */
  pourEvenement(nom: 'execution.lancee' | 'execution.terminee'): PluginCharge[] {
    return this.all().filter((charge) => typeof charge.instance.events?.[nom] === 'function');
  }

  /** Les taches de fond declarees, avec le plugin qui les porte. */
  taches(): { charge: PluginCharge; tache: TacheDuPlugin }[] {
    return this.all().flatMap((charge) =>
      (charge.instance.tasks ?? []).map((tache) => ({ charge, tache })),
    );
  }

  /**
   * Les droits d'un plugin, au format du catalogue.
   *
   * Les libelles voyagent avec la definition : un plugin ne peut pas ajouter de
   * clefs aux dictionnaires du coeur, qui sont compiles dans le paquet de
   * l'interface.
   */
  private droitsDe(manifeste: PluginManifest): RightDefinition[] {
    return manifeste.rights.map((droit) => ({
      object: objetDuDroit(manifeste.id, droit.object),
      action: droit.action,
      labelKey: `plugins.${manifeste.id}.${droit.object}.${droit.action}`,
      label: droit.label,
      groupLabel: { fr: manifeste.name, en: manifeste.name },
      scopes: droit.scopes,
    }));
  }
}
