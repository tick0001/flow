import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  executionLogsQuerySchema,
  executionsQuerySchema,
  startExecutionSchema,
  type ExecutionDetail,
  type ExecutionLog,
  type ExecutionSummary,
  type StartExecution,
} from '@flow/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ExecutionsService } from './executions.service.js';

@Controller('executions')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  /**
   * Lance un bot.
   *
   * Le droit exige est `bot:execute` et non `execution:create` : c'est le bot
   * qu'on a le droit de lancer, l'execution n'etant que la trace de ce
   * lancement. Deux droits pour un seul acte auraient donne une combinaison sans
   * signification -- le droit de creer des traces sans le droit de lancer.
   */
  @Post()
  @RequireRight('bot', 'execute')
  start(
    @Body(new ZodValidationPipe(startExecutionSchema)) corps: StartExecution,
  ): Promise<ExecutionSummary> {
    return this.executions.start(corps);
  }

  @Get()
  @RequireRight('execution', 'read')
  list(
    @Query(new ZodValidationPipe(executionsQuerySchema))
    requete: ReturnType<typeof executionsQuerySchema.parse>,
  ): Promise<{ items: ExecutionSummary[]; nextCursor: string | null }> {
    return this.executions.list(requete);
  }

  @Get(':id')
  @RequireRight('execution', 'read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ExecutionDetail> {
    return this.executions.get(id);
  }

  /**
   * Le journal, a partir d'un rang.
   *
   * Une route a part et non un champ du detail : un journal fait des milliers de
   * lignes, et les joindre au detail obligerait a tout recharger pour apprendre
   * qu'une execution a change d'etat.
   */
  @Get(':id/logs')
  @RequireRight('execution', 'read')
  logs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(executionLogsQuerySchema))
    requete: ReturnType<typeof executionLogsQuerySchema.parse>,
  ): Promise<ExecutionLog[]> {
    return this.executions.logs(id, requete);
  }

  /**
   * Demande l'interruption.
   *
   * `POST` et non `DELETE` : on ne supprime rien. L'execution garde sa trace, son
   * journal et ce qu'elle avait deja produit -- c'est meme souvent pour cela
   * qu'on l'interrompt.
   */
  @Post(':id/cancel')
  @RequireRight('execution', 'cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<ExecutionDetail> {
    return this.executions.cancel(id);
  }
}
