import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BotsModule } from '../bots/bots.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { ExecutionMaintenanceService } from './maintenance.service.js';
import { ExecutionsController } from './executions.controller.js';
import { ExecutionsService } from './executions.service.js';

@Module({
  imports: [AuthModule, BotsModule, QueueModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionMaintenanceService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
