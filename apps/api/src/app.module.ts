import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { BotsModule } from './bots/bots.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { ExecutionsModule } from './executions/executions.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';
import { SchedulesModule } from './schedules/schedules.module.js';
import { ApiKeysModule } from './apikeys/apikeys.module.js';
import { StatsModule } from './stats/stats.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    AuthModule,
    QueueModule,
    HealthModule,
    EntitiesModule,
    AdminModule,
    BotsModule,
    ExecutionsModule,
    SchedulesModule,
    ApiKeysModule,
    StatsModule,
  ],
})
export class AppModule {}
