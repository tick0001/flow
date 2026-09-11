import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSchedule,
  CronPreview,
  Schedule,
  ScheduleDetail,
  UpdateSchedule,
} from '@flow/contracts';
import { and, desc, entities, eq, schedules, sql, users, type SQL } from '@flow/db';
import { displayNameOf } from '../common/display-name.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { BotRegistryService } from '../bots/bot-registry.service.js';
import { ParameterValidatorService } from '../bots/parameter-validator.service.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { analyser, fuseauConnu, prochain } from './cron.js';

/** Derniers declenchements montres sur le detail d'une planification. */
const RECENTES = 10;

@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registre: BotRegistryService,
    private readonly parametres: ParameterValidatorService,
    private readonly rights: RightsService,
    private readonly executions: ExecutionsService,
  ) {}

  /**
   * Apercu d'une expression cron.
   *
   * Rendu par le serveur, avec l'analyseur qui declenchera reellement. Voir
   * « les cinq prochains declenchements » pendant la saisie vaut mieux que
   * relire une expression a cinq champs pour se convaincre qu'on a compris -- et
   * un apercu calcule ailleurs finirait par ne plus dire la meme chose.
   */
  apercu(expression: string, timezone: string): CronPreview {
    if (!fuseauConnu(timezone)) {
      return { valid: false, error: `Fuseau horaire inconnu : ${timezone}`, next: [] };
    }

    return analyser(expression, timezone);
  }

  async list(): Promise<Schedule[]> {
    return this.lire();
  }

  async get(id: string): Promise<ScheduleDetail> {
    const [planification] = await this.lire(id);

    if (!planification) throw new NotFoundException("Cette planification n'existe pas.");

    const { items } = await this.executions.list({ scheduleId: id, limit: RECENTES });

    return { ...planification, recentExecutions: items };
  }

  /**
   * Cree une planification dans l'entite active.
   *
   * Les parametres sont valides **maintenant**, contre le schema du bot, et non
   * au premier declenchement : une planification fautive doit se voir tout de
   * suite, pas a trois heures du matin dans un journal que personne ne lit.
   */
  async create(donnees: CreateSchedule): Promise<Schedule> {
    const context = requireContext();
    const bot = this.verifierLeBot(donnees.botId);
    const parametres = this.parametres.valider(bot, donnees.parameters);

    this.verifierLaCadence(donnees.cron, donnees.timezone);

    const [creee] = await this.db.asUser((tx) =>
      tx
        .insert(schedules)
        .values({
          name: donnees.name,
          botId: bot.id,
          parameters: parametres,
          headed: donnees.headed,
          cron: donnees.cron,
          timezone: donnees.timezone,
          isActive: donnees.isActive,
          entityId: context.entityId,
          ownerId: context.userId,
          profileId: context.profileId,
          nextRunAt: donnees.isActive ? prochain(donnees.cron, donnees.timezone) : null,
        })
        .returning({ id: schedules.id }),
    );

    if (!creee) throw new BadRequestException("La planification n'a pas pu etre creee.");

    const [relue] = await this.lire(creee.id);

    if (!relue) throw new NotFoundException("La planification n'a pas pu etre relue.");

    return relue;
  }

  async update(id: string, donnees: UpdateSchedule): Promise<Schedule> {
    const [existante] = await this.lire(id);

    if (!existante) throw new NotFoundException("Cette planification n'existe pas.");

    await this.verifierLaPortee('update', existante.owner.id);

    const cron = donnees.cron ?? existante.cron;
    const timezone = donnees.timezone ?? existante.timezone;
    const actif = donnees.isActive ?? existante.isActive;

    if (donnees.cron !== undefined || donnees.timezone !== undefined) {
      this.verifierLaCadence(cron, timezone);
    }

    const botId = donnees.botId ?? existante.botId;
    const bot = donnees.botId === undefined ? null : this.verifierLeBot(donnees.botId);

    // Les parametres sont revalides des que l'un des deux change : viser un
    // autre bot avec les anciens parametres est la facon la plus simple de
    // casser une planification sans s'en apercevoir.
    const parametres =
      donnees.parameters === undefined && donnees.botId === undefined
        ? undefined
        : this.parametres.valider(
            bot ?? this.verifierLeBot(botId),
            donnees.parameters ?? existante.parameters,
          );

    await this.db.asUser((tx) =>
      tx
        .update(schedules)
        .set({
          ...(donnees.name === undefined ? {} : { name: donnees.name }),
          ...(donnees.botId === undefined ? {} : { botId: donnees.botId }),
          ...(parametres === undefined ? {} : { parameters: parametres }),
          ...(donnees.headed === undefined ? {} : { headed: donnees.headed }),
          cron,
          timezone,
          isActive: actif,
          // Recalcule a chaque modification, et remis a nul quand on desactive :
          // une planification inactive dont la date de prochain declenchement
          // resterait dans le passe repartirait des sa reactivation, sans que
          // personne ne l'ait demande.
          nextRunAt: actif ? prochain(cron, timezone) : null,
          updatedAt: sql`now()`,
        })
        .where(eq(schedules.id, id)),
    );

    const [relue] = await this.lire(id);

    if (!relue) throw new NotFoundException("La planification n'a pas pu etre relue.");

    return relue;
  }

  /**
   * Supprime une planification.
   *
   * Les executions qu'elle a produites **restent** : leur lien passe a nul. On
   * supprime souvent une planification precisement pour relire ce qu'elle a
   * fait, et emporter l'historique avec elle serait le contraire de ce qu'on
   * veut.
   */
  async remove(id: string): Promise<void> {
    const [existante] = await this.lire(id);

    if (!existante) throw new NotFoundException("Cette planification n'existe pas.");

    await this.verifierLaPortee('delete', existante.owner.id);

    await this.db.asUser((tx) => tx.delete(schedules).where(eq(schedules.id, id)));
  }

  // --- interne ---------------------------------------------------------------

  private verifierLeBot(botId: string) {
    const bot = this.registre.get(botId);

    if (!bot) throw new NotFoundException("Ce bot n'existe pas sur cette installation.");
    if (!bot.loaded) {
      throw new BadRequestException(bot.loadError ?? 'Ce bot est refuse par cette installation.');
    }

    return bot.manifest;
  }

  private verifierLaCadence(cron: string, timezone: string): void {
    const apercu = this.apercu(cron, timezone);

    if (!apercu.valid) {
      throw new BadRequestException({
        message: 'Cadence invalide.',
        issues: [{ chemin: 'cron', message: apercu.error ?? 'expression refusee' }],
      });
    }
  }

  private async verifierLaPortee(action: string, proprietaire: number): Promise<void> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'schedule', action);

    if (portee === 'own' && proprietaire !== context.userId) {
      throw new ForbiddenException('Ce droit ne porte que sur vos propres planifications.');
    }
  }

  private async lire(id?: string): Promise<Schedule[]> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'schedule', 'read');
    const conditions: SQL[] = [];

    if (portee === 'own') conditions.push(eq(schedules.ownerId, context.userId));
    if (portee === 'entity') conditions.push(eq(schedules.entityId, context.entityId));
    if (id) conditions.push(eq(schedules.id, id));

    const lignes = await this.db.asUser((tx) =>
      tx
        .select({
          id: schedules.id,
          name: schedules.name,
          botId: schedules.botId,
          cron: schedules.cron,
          timezone: schedules.timezone,
          parameters: schedules.parameters,
          headed: schedules.headed,
          isActive: schedules.isActive,
          entityId: schedules.entityId,
          entityName: entities.name,
          ownerId: schedules.ownerId,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
          nextRunAt: schedules.nextRunAt,
          lastRunAt: schedules.lastRunAt,
          createdAt: schedules.createdAt,
        })
        .from(schedules)
        .innerJoin(entities, eq(entities.id, schedules.entityId))
        .innerJoin(users, eq(users.id, schedules.ownerId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schedules.createdAt)),
    );

    // La capacite est croisee ici une fois : le droit, sa portee et le
    // proprietaire. L'interface lit un booleen deja calcule, et ne peut pas se
    // tromper differemment du serveur.
    const porteeGestion = await this.rights.scopeFor(context.profileId, 'schedule', 'update');

    return lignes.map((ligne) => ({
      id: ligne.id,
      name: ligne.name,
      botId: ligne.botId,
      // Le nom du bot vient du registre, et non d'une copie : contrairement a une
      // execution, une planification vise le bot **d'aujourd'hui**. Nul quand il
      // n'est plus depose, ce que l'interface signale.
      botName: this.registre.get(ligne.botId)?.manifest.name ?? null,
      cron: ligne.cron,
      timezone: ligne.timezone,
      parameters: ligne.parameters,
      headed: ligne.headed,
      isActive: ligne.isActive,
      entity: { id: ligne.entityId, name: ligne.entityName },
      owner: { id: ligne.ownerId, displayName: displayNameOf(ligne) },
      nextRunAt: ligne.nextRunAt,
      lastRunAt: ligne.lastRunAt,
      createdAt: ligne.createdAt,
      canManage:
        porteeGestion !== undefined &&
        (porteeGestion !== 'own' || ligne.ownerId === context.userId),
    }));
  }
}
