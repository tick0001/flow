import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfilesController, UsersController } from './admin.controller.js';
import { ProfilesService } from './profiles.service.js';
import { RightsCatalogService } from './rights-catalog.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, ProfilesController],
  providers: [UsersService, ProfilesService, RightsCatalogService],
  exports: [RightsCatalogService],
})
export class AdminModule {}
