import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { BotsModule } from './bots/bots.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { ExecutionsModule } from './executions/executions.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    QueueModule,
    HealthModule,
    EntitiesModule,
    AdminModule,
    BotsModule,
    ExecutionsModule,
  ],
})
export class AppModule {}
