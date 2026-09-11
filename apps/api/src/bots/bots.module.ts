import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BotRegistryService } from './bot-registry.service.js';
import { BotsController } from './bots.controller.js';
import { ParameterValidatorService } from './parameter-validator.service.js';

@Module({
  imports: [AuthModule],
  controllers: [BotsController],
  providers: [BotRegistryService, ParameterValidatorService],
  exports: [BotRegistryService, ParameterValidatorService],
})
export class BotsModule {}
