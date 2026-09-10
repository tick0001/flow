import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { BotSummary } from '@flow/contracts';
import { requireContext } from '../common/request-context.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { RightsService } from '../auth/rights.service.js';
import { BotRegistryService, type RegisteredBot } from './bot-registry.service.js';

@Controller('bots')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class BotsController {
  constructor(
    private readonly registre: BotRegistryService,
    private readonly rights: RightsService,
  ) {}

  @Get()
  @RequireRight('bot', 'read')
  async list(): Promise<BotSummary[]> {
    const context = requireContext();
    const droits = await this.rights.rightsFor(context.profileId);

    // Les capacites sont resolues une fois, pour le profil actif : elles ne
    // dependent pas du bot tant qu'il n'y a pas de droit par bot. Le jour ou
    // celui-ci arrivera, c'est ici qu'il se croisera -- et l'interface n'aura
    // rien a changer, puisqu'elle lit deja des booleens deja calcules.
    const canExecute = droits.has('bot:execute');
    const canManage = droits.has('bot:manage');

    return this.registre.all().map((bot) => resumer(bot, canExecute, canManage));
  }

  /**
   * Relit le dossier des bots.
   *
   * Explicite, jamais declenche par une surveillance de dossier : plusieurs
   * workers rechargeraient chacun a son rythme, et une execution en cours
   * verrait son module disparaitre sous elle.
   */
  @Post('reload')
  @RequireRight('bot', 'manage')
  async reload(): Promise<BotSummary[]> {
    const bots = await this.registre.reload();

    return bots.map((bot) => resumer(bot, true, true));
  }
}

function resumer(bot: RegisteredBot, canExecute: boolean, canManage: boolean): BotSummary {
  return {
    manifest: bot.manifest,
    loaded: bot.loaded,
    loadError: bot.loadError,
    // Un bot refuse ne se lance pas, quels que soient les droits : proposer le
    // bouton ferait echouer l'appel plus loin, avec un message moins clair que
    // le motif deja affiche sur la carte.
    canExecute: canExecute && bot.loaded,
    canManage,
  };
}
