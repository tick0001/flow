import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysController } from './apikeys.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
})
export class ApiKeysModule {}
