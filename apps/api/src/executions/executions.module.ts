import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BotsModule } from '../bots/bots.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { ExecutionMaintenanceService } from './maintenance.service.js';
import { ExecutionsController } from './executions.controller.js';
import { ExecutionsService } from './executions.service.js';
import { ExecutionPurgeService } from './purge.service.js';
import { ExecutionRelayService } from './relais.service.js';
import { ExecutionStreamService } from './stream.service.js';

@Module({
  imports: [AuthModule, BotsModule, QueueModule, PluginsModule],
  controllers: [ExecutionsController],
  providers: [
    ExecutionsService,
    ExecutionMaintenanceService,
    ExecutionRelayService,
    ExecutionStreamService,
    ExecutionPurgeService,
  ],
  exports: [ExecutionsService, ExecutionRelayService],
})
export class ExecutionsModule {}
