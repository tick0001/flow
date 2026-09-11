import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createScheduleSchema,
  updateScheduleSchema,
  type CreateSchedule,
  type CronPreview,
  type Schedule,
  type ScheduleDetail,
  type UpdateSchedule,
} from '@flow/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { SchedulesService } from './schedules.service.js';

const apercuSchema = z.object({
  cron: z.string().min(1).max(120),
  timezone: z.string().min(3).max(64),
});

@Controller('schedules')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequireRight('schedule', 'read')
  list(): Promise<Schedule[]> {
    return this.schedules.list();
  }

  /**
   * Apercu d'une expression cron.
   *
   * Sous le droit de lecture et non de creation : on regarde ce qu'une cadence
   * donnerait bien avant de decider si l'on a le droit d'en poser une, et
   * refuser l'apercu a qui peut deja lire les planifications n'aurait protege
   * rien du tout.
   *
   * Declaree avant `:id`, faute de quoi « apercu » serait pris pour un
   * identifiant -- que le `ParseUUIDPipe` refuserait avec un message sans
   * rapport.
   */
  @Get('apercu')
  @RequireRight('schedule', 'read')
  apercu(
    @Query(new ZodValidationPipe(apercuSchema)) requete: z.infer<typeof apercuSchema>,
  ): CronPreview {
    return this.schedules.apercu(requete.cron, requete.timezone);
  }

  @Get(':id')
  @RequireRight('schedule', 'read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ScheduleDetail> {
    return this.schedules.get(id);
  }

  @Post()
  @RequireRight('schedule', 'create')
  create(
    @Body(new ZodValidationPipe(createScheduleSchema)) corps: CreateSchedule,
  ): Promise<Schedule> {
    return this.schedules.create(corps);
  }

  @Patch(':id')
  @RequireRight('schedule', 'update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateScheduleSchema)) corps: UpdateSchedule,
  ): Promise<Schedule> {
    return this.schedules.update(id, corps);
  }

  @Delete(':id')
  @RequireRight('schedule', 'delete')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.schedules.remove(id);

    return { ok: true };
  }
}
