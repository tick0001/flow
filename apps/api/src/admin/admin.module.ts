import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RightsCatalogModule } from './rights-catalog.module.js';
import { ProfilesController, UsersController } from './admin.controller.js';
import { ProfilesService } from './profiles.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, RightsCatalogModule],
  controllers: [UsersController, ProfilesController],
  providers: [UsersService, ProfilesService],
  exports: [RightsCatalogModule],
})
export class AdminModule {}
