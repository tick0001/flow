import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BotsModule } from '../bots/bots.module.js';
import { ExecutionsModule } from '../executions/executions.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { SchedulePlannerService } from './planner.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

@Module({
  imports: [AuthModule, BotsModule, QueueModule, ExecutionsModule],
  controllers: [SchedulesController],
  providers: [SchedulesService, SchedulePlannerService],
})
export class SchedulesModule {}
