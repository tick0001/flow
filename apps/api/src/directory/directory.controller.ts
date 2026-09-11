import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createDirectoryRuleSchema,
  updateDirectoryRuleSchema,
  type CreateDirectoryRule,
  type DirectoryRule,
  type UpdateDirectoryRule,
} from '@flow/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { DirectoryRulesService } from './directory.service.js';

/**
 * Les regles d'affectation depuis l'annuaire.
 *
 * Sous leur propre droit, et non sous `user:update` : poser une regle n'est pas
 * modifier un compte, c'est decider de ce que vaudra un groupe pour tous les
 * comptes a venir. Les separer permet de confier l'administration des comptes
 * sans confier celle de l'annuaire.
 */
@Controller('directory/rules')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class DirectoryController {
  constructor(private readonly regles: DirectoryRulesService) {}

  @Get()
  @RequireRight('directory', 'read')
  liste(): Promise<DirectoryRule[]> {
    return this.regles.list();
  }

  @Post()
  @RequireRight('directory', 'manage')
  creer(
    @Body(new ZodValidationPipe(createDirectoryRuleSchema)) demande: CreateDirectoryRule,
  ): Promise<DirectoryRule> {
    return this.regles.create(demande);
  }

  @Patch(':id')
  @RequireRight('directory', 'manage')
  modifier(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateDirectoryRuleSchema)) demande: UpdateDirectoryRule,
  ): Promise<DirectoryRule> {
    return this.regles.update(id, demande);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireRight('directory', 'manage')
  async supprimer(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.regles.remove(id);
  }
}
