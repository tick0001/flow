import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { statsQuerySchema, type Pilotage, type StatsQuery } from '@flow/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { StatsService } from './stats.service.js';

/**
 * Plafond d'un export.
 *
 * Cinquante mille lignes tiennent dans un tableur et dans la memoire du serveur.
 * Au-dela, ce qu'on cherche n'est plus un export mais une requete : affiner la
 * periode ou le bot donne un fichier qu'on peut reellement ouvrir.
 */
const PLAFOND_EXPORT = 50_000;

@Controller('stats')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * Tout l'ecran de pilotage.
   *
   * Sous son propre droit et non sous `execution:read` : un tableau de bord
   * montre des taux et des durees, pas le detail d'une execution. Les separer
   * permet de donner les chiffres a qui pilote sans lui ouvrir les journaux --
   * qui contiennent, eux, ce qu'un bot a lu sur les pages qu'il a visitees.
   */
  @Get()
  @RequireRight('stats', 'read')
  pilotage(@Query(new ZodValidationPipe(statsQuerySchema)) requete: StatsQuery): Promise<Pilotage> {
    return this.stats.pilotage(requete);
  }

  /**
   * Les executions de la periode, en CSV.
   *
   * Servi en piece jointe avec un nom date : un fichier « export.csv » de plus
   * dans un dossier de telechargements ne se retrouve pas.
   */
  @Get('export.csv')
  @RequireRight('stats', 'read')
  async exporter(
    @Query(new ZodValidationPipe(statsQuerySchema)) requete: StatsQuery,
    @Res() reponse: Response,
  ): Promise<void> {
    const { csv, tronque } = await this.stats.exporterCsv(requete, PLAFOND_EXPORT);
    const jour = new Date().toISOString().slice(0, 10);

    reponse.setHeader('Content-Type', 'text/csv; charset=utf-8');
    reponse.setHeader('Content-Disposition', `attachment; filename="flow-${jour}.csv"`);
    if (tronque) reponse.setHeader('X-Flow-Tronque', 'true');

    // La marque d'ordre des octets : sans elle, Excel lit un CSV en UTF-8 comme
    // s'il etait dans l'encodage de la machine, et « Réussie » devient
    // « RÃ©ussie ». Les autres tableurs l'ignorent.
    reponse.send(`\uFEFF${csv}`);
  }
}
