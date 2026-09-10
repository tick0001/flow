import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { BotsModule } from './bots/bots.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, HealthModule, EntitiesModule, AdminModule, BotsModule],
})
export class AppModule {}
