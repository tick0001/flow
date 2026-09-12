import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createBotRuleSchema,
  type BotRule,
  type BotSummary,
  type CreateBotRule,
} from '@flow/contracts';
import { requireContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { RightsService } from '../auth/rights.service.js';
import { BotRegistryService, type RegisteredBot } from './bot-registry.service.js';
import { BotRulesService } from './bot-rules.service.js';

@Controller('bots')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class BotsController {
  constructor(
    private readonly registre: BotRegistryService,
    private readonly regles: BotRulesService,
    private readonly rights: RightsService,
  ) {}

  /**
   * Le catalogue, tel que le demandeur a le droit de le voir.
   *
   * **Un bot n'est propose que la ou une regle l'ouvre.** Le registre est global
   * a l'installation -- c'est un dossier sur le disque --, mais la mise a
   * disposition se decide par entite et par profil : voir
   * `bot-rules.service.ts`.
   *
   * Les porteurs de `bot:manage` voient en plus les bots fermes, marques comme
   * tels. Sans cela, un bot fraichement depose serait invisible de tout le
   * monde, y compris de qui doit l'ouvrir : le refus par defaut deviendrait
   * indiscernable d'une panne du registre.
   */
  @Get()
  @RequireRight('bot', 'read')
  async list(): Promise<BotSummary[]> {
    const context = requireContext();
    const droits = await this.rights.rightsFor(context.profileId);

    const canExecute = droits.has('bot:execute');
    const canManage = droits.has('bot:manage');

    const ouverts = await this.regles.disponibles(context.profileId, context.entityPath);

    return this.registre
      .all()
      .map((bot) => resumer(bot, ouverts.has(bot.manifest.id), canExecute, canManage))
      .filter((bot) => bot.available || canManage);
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
    const context = requireContext();
    const bots = await this.registre.reload();
    const ouverts = await this.regles.disponibles(context.profileId, context.entityPath);

    return bots.map((bot) => resumer(bot, ouverts.has(bot.manifest.id), true, true));
  }
}

/**
 * Les regles de mise a disposition.
 *
 * Sous `bot:manage`, et non sous `bot:execute` : decider ou un bot est propose
 * n'est pas le lancer. Les separer permet de confier le lancement a une equipe
 * d'exploitation sans lui confier la carte de ce qui tourne ou.
 */
@Controller('bots/regles')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class BotRulesController {
  constructor(private readonly regles: BotRulesService) {}

  @Get()
  @RequireRight('bot', 'manage')
  liste(): Promise<BotRule[]> {
    return this.regles.list();
  }

  @Post()
  @RequireRight('bot', 'manage')
  creer(
    @Body(new ZodValidationPipe(createBotRuleSchema)) demande: CreateBotRule,
  ): Promise<BotRule> {
    return this.regles.create(demande);
  }

  @Delete(':id')
  @RequireRight('bot', 'manage')
  @HttpCode(204)
  supprimer(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.regles.remove(id);
  }
}

function resumer(
  bot: RegisteredBot,
  available: boolean,
  canExecute: boolean,
  canManage: boolean,
): BotSummary {
  return {
    manifest: bot.manifest,
    loaded: bot.loaded,
    loadError: bot.loadError,
    available,
    // Un bot refuse ou ferme ne se lance pas, quels que soient les droits :
    // proposer le bouton ferait echouer l'appel plus loin, avec un message
    // moins clair que le motif deja affiche sur la carte.
    canExecute: canExecute && bot.loaded && available,
    canManage,
  };
}
