import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { pluginSlotSchema, type PluginAsset, type PluginSummary } from '@flow/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { RightsService } from '../auth/rights.service.js';
import { DatabaseService } from '../database/database.service.js';
import { requireContext } from '../common/request-context.js';
import { contextePour } from './contexte.js';
import { PluginRegistryService } from './registre.service.js';
import { PluginInstallerService } from './installateur.service.js';
import { PluginHostService, objetDuDroit } from './hote.service.js';

@Controller('plugins')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class PluginsController {
  constructor(
    private readonly registre: PluginRegistryService,
    private readonly installateur: PluginInstallerService,
    private readonly hote: PluginHostService,
    private readonly droits: RightsService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Tout ce qui est pose sur le disque, et tout ce qui est installe.
   *
   * **L'union des deux, et non l'un ou l'autre.** Un dossier depose et jamais
   * installe doit se voir pour qu'on puisse l'installer ; une ligne dont le
   * dossier a disparu doit se voir pour qu'on puisse la desinstaller. Ne montrer
   * que l'intersection laisserait les deux cas invisibles -- et le second laisse
   * des tables et des droits derriere lui.
   */
  @Get()
  @RequireRight('plugin', 'read')
  async liste(): Promise<PluginSummary[]> {
    const installes = new Map(
      (await this.installateur.installes()).map((ligne) => [ligne.id, ligne]),
    );
    const resumes: PluginSummary[] = [];

    for (const decouvert of this.registre.all()) {
      const installe = installes.get(decouvert.id);
      const manifeste = decouvert.manifest;

      installes.delete(decouvert.id);

      resumes.push({
        id: decouvert.id,
        name: manifeste?.name ?? installe?.name ?? decouvert.id,
        description: manifeste?.description ?? '',
        version: manifeste?.version ?? null,
        installedVersion: installe?.version ?? null,
        author: manifeste?.author ?? '',
        state:
          manifeste === null
            ? 'refuse'
            : installe === undefined
              ? 'disponible'
              : installe.isEnabled
                ? 'actif'
                : 'inactif',
        reason: decouvert.reason,
        schema: manifeste?.schema ?? installe?.schemaName !== null,
        rights: manifeste?.rights ?? [],
        hooks: manifeste?.hooks ?? [],
        events: manifeste?.events ?? [],
        surfaces: manifeste?.surfaces ?? [],
        views: manifeste?.views ?? [],
        tasks: manifeste?.tasks ?? [],
      });
    }

    // Ce qui reste est installe sans etre sur le disque : des orphelins.
    for (const ligne of installes.values()) {
      resumes.push({
        id: ligne.id,
        name: ligne.name,
        description: '',
        version: null,
        installedVersion: ligne.version,
        author: '',
        state: 'orphelin',
        reason:
          'Installe, mais absent du dossier des plugins. Son schema et ses droits sont toujours en base.',
        schema: ligne.schemaName !== null,
        rights: [],
        hooks: [],
        events: [],
        surfaces: [],
        views: [],
        tasks: [],
      });
    }

    return resumes.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Les emplacements a remplir, pour l'interface.
   *
   * Sous le simple fait d'etre connecte, et non sous `plugin:read` : lire la
   * liste des plugins est une affaire d'administration, tandis que voir un
   * encart pose par un plugin est l'usage courant de l'application.
   */
  @Get('emplacements')
  emplacements(): PluginAsset[] {
    return this.hote.all().flatMap((charge) =>
      charge.manifest.surfaces.map((surface) => ({
        pluginId: charge.manifest.id,
        pluginName: charge.manifest.name,
        slot: surface.slot,
        url: `/api/plugins/${charge.manifest.id}/interface/${surface.slot}`,
      })),
    );
  }

  /**
   * Sert le module d'interface d'un plugin.
   *
   * Le client ne choisit pas de fichier : il nomme un **emplacement**, et le
   * manifeste dit quel fichier le remplit. Aucun chemin ne vient donc de
   * l'exterieur, et la question de la traversee de repertoire ne se pose pas --
   * la reponse est verifiee une seconde fois malgre tout, parce que le manifeste
   * est ecrit par quelqu'un d'autre.
   */
  @Get(':id/interface/:slot')
  async interface(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Res() reponse: Response,
  ): Promise<void> {
    const lecture = pluginSlotSchema.safeParse(slot);

    if (!lecture.success) throw new NotFoundException('Emplacement inconnu.');

    const charge = this.hote.get(id);

    if (!charge) throw new NotFoundException('Plugin inactif ou inconnu.');

    const surface = charge.manifest.surfaces.find((candidate) => candidate.slot === lecture.data);

    if (!surface) throw new NotFoundException('Ce plugin ne remplit pas cet emplacement.');

    const racine = resolve(charge.directory);
    const fichier = resolve(racine, surface.entry);

    if (fichier !== racine && !fichier.startsWith(racine + sep)) {
      throw new NotFoundException('Fichier hors du dossier du plugin.');
    }

    const infos = await stat(fichier).catch(() => null);

    if (!infos?.isFile()) throw new NotFoundException('Fichier absent.');

    reponse.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    // Pas de cache : un plugin mis a jour doit se voir au rechargement de la
    // page, et ces fichiers sont minuscules.
    reponse.setHeader('Cache-Control', 'no-store');

    createReadStream(fichier).pipe(reponse);
  }

  /**
   * Appelle une vue d'un plugin.
   *
   * C'est la voie par laquelle l'encart d'un plugin lit ses propres tables : le
   * coeur ne sait pas les lire, et le navigateur ne parle pas a PostgreSQL.
   *
   * La vue s'execute **sous le contexte de l'appelant**, comme un hook : les
   * politiques du plugin s'appliquent, et deux personnes de deux branches n'y
   * voient pas la meme chose. Le droit, lui, est verifie ici plutot que par le
   * decorateur : il est nomme par le manifeste, pas connu a la compilation.
   */
  @Get(':id/vues/:nom')
  async vue(
    @Param('id') id: string,
    @Param('nom') nom: string,
    @Query() parametres: Record<string, string>,
  ): Promise<unknown> {
    const charge = this.hote.get(id);

    if (!charge) throw new NotFoundException('Plugin inactif ou inconnu.');

    const declaree = charge.manifest.views.find((candidate) => candidate.name === nom);
    const fonction = charge.instance.views?.find((candidate) => candidate.name === nom)?.run;

    if (!declaree || !fonction) throw new NotFoundException('Vue inconnue.');

    if (declaree.right !== undefined) {
      const [objet, action] = declaree.right.split(':');
      const contexte = requireContext();
      const autorise =
        objet !== undefined &&
        action !== undefined &&
        (await this.droits.can(contexte.profileId, objetDuDroit(id, objet), action));

      if (!autorise) {
        throw new ForbiddenException(`Droit manquant : ${id}.${declaree.right}`);
      }
    }

    return fonction(contextePour(this.db, id, charge.schema, requireContext()), parametres);
  }

  /** Relit le dossier : un plugin depose apparait sans redemarrage. */
  @Post('relire')
  @RequireRight('plugin', 'manage')
  async relire(): Promise<PluginSummary[]> {
    await this.registre.relire();

    return this.liste();
  }

  @Post(':id/installer')
  // 204 plutot que le 201 par defaut de NestJS : l'operation a reussi et il
  // n'y a rien a en dire. Un 201 au corps vide se lit comme une ressource
  // creee dont on aurait oublie de rendre la representation.
  @HttpCode(204)
  @RequireRight('plugin', 'manage')
  async installer(@Param('id') id: string): Promise<void> {
    await this.installateur.installer(id);
  }

  @Post(':id/activer')
  // 204 plutot que le 201 par defaut de NestJS : l'operation a reussi et il
  // n'y a rien a en dire. Un 201 au corps vide se lit comme une ressource
  // creee dont on aurait oublie de rendre la representation.
  @HttpCode(204)
  @RequireRight('plugin', 'manage')
  async activer(@Param('id') id: string): Promise<void> {
    await this.installateur.basculer(id, true);
  }

  @Post(':id/desactiver')
  // 204 plutot que le 201 par defaut de NestJS : l'operation a reussi et il
  // n'y a rien a en dire. Un 201 au corps vide se lit comme une ressource
  // creee dont on aurait oublie de rendre la representation.
  @HttpCode(204)
  @RequireRight('plugin', 'manage')
  async desactiver(@Param('id') id: string): Promise<void> {
    await this.installateur.basculer(id, false);
  }

  /** Desinstalle : le schema, les droits et la ligne s'en vont. */
  @Delete(':id')
  // 204 plutot que le 201 par defaut de NestJS : l'operation a reussi et il
  // n'y a rien a en dire. Un 201 au corps vide se lit comme une ressource
  // creee dont on aurait oublie de rendre la representation.
  @HttpCode(204)
  @RequireRight('plugin', 'manage')
  async desinstaller(@Param('id') id: string): Promise<void> {
    await this.installateur.desinstaller(id);
  }
}
