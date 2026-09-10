import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createUserSchema,
  grantAuthorizationSchema,
  resetPasswordSchema,
  updateUserSchema,
  upsertProfileSchema,
  type CreateUser,
  type GrantAuthorization,
  type ProfileDetail,
  type ResetPassword,
  type RightsCatalog,
  type UpdateUser,
  type UpsertProfile,
  type UserSummary,
} from '@flow/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProfilesService } from './profiles.service.js';
import { RightsCatalogService } from './rights-catalog.service.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireRight('user', 'read')
  list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  @Get(':id')
  @RequireRight('user', 'read')
  get(@Param('id', ParseIntPipe) id: number): Promise<UserSummary> {
    return this.users.get(id);
  }

  @Post()
  @RequireRight('user', 'create')
  create(@Body(new ZodValidationPipe(createUserSchema)) corps: CreateUser): Promise<UserSummary> {
    return this.users.create(corps);
  }

  @Patch(':id')
  @RequireRight('user', 'update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateUserSchema)) corps: UpdateUser,
  ): Promise<UserSummary> {
    return this.users.update(id, corps);
  }

  @Post(':id/password')
  @RequireRight('user', 'update')
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(resetPasswordSchema)) corps: ResetPassword,
  ): Promise<{ ok: true }> {
    await this.users.resetPassword(id, corps.password);

    return { ok: true };
  }

  /**
   * Accorder une habilitation, c'est distribuer des droits : l'action releve de
   * `user:update` sur le compte vise, mais la verification qui compte est
   * ailleurs -- le service refuse une entite hors du perimetre de celui qui
   * accorde.
   */
  @Post(':id/authorizations')
  @RequireRight('user', 'update')
  grant(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(grantAuthorizationSchema)) corps: GrantAuthorization,
  ): Promise<UserSummary> {
    return this.users.grant(id, corps);
  }

  @Delete(':id/authorizations/:entityId/:profileId')
  @RequireRight('user', 'update')
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Param('entityId', ParseIntPipe) entityId: number,
    @Param('profileId', ParseIntPipe) profileId: number,
  ): Promise<UserSummary> {
    return this.users.revoke(id, entityId, profileId);
  }

  @Delete(':id')
  @RequireRight('user', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.users.remove(id);

    return { ok: true };
  }
}

@Controller('profiles')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly catalogue: RightsCatalogService,
  ) {}

  /**
   * Le catalogue des droits, pour que l'interface dessine sa matrice.
   *
   * Sous `profile:read` : savoir quels droits existent revient a connaitre la
   * surface d'administration de l'installation.
   */
  @Get('catalog')
  @RequireRight('profile', 'read')
  catalog(): RightsCatalog {
    return this.catalogue.all();
  }

  @Get()
  @RequireRight('profile', 'read')
  list(): Promise<ProfileDetail[]> {
    return this.profiles.list();
  }

  @Get(':id')
  @RequireRight('profile', 'read')
  get(@Param('id', ParseIntPipe) id: number): Promise<ProfileDetail> {
    return this.profiles.get(id);
  }

  @Post()
  @RequireRight('profile', 'create')
  create(
    @Body(new ZodValidationPipe(upsertProfileSchema)) corps: UpsertProfile,
  ): Promise<ProfileDetail> {
    return this.profiles.create(corps);
  }

  @Patch(':id')
  @RequireRight('profile', 'update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertProfileSchema)) corps: UpsertProfile,
  ): Promise<ProfileDetail> {
    return this.profiles.update(id, corps);
  }

  @Delete(':id')
  @RequireRight('profile', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.profiles.remove(id);

    return { ok: true };
  }
}
