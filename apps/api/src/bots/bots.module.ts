import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BotRegistryService } from './bot-registry.service.js';
import { BotRulesService } from './bot-rules.service.js';
import { BotRulesController, BotsController } from './bots.controller.js';
import { ParameterValidatorService } from './parameter-validator.service.js';

@Module({
  imports: [AuthModule],
  controllers: [BotsController, BotRulesController],
  providers: [BotRegistryService, BotRulesService, ParameterValidatorService],
  exports: [BotRegistryService, BotRulesService, ParameterValidatorService],
})
export class BotsModule {}
