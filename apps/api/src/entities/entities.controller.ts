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
import type { EntityRef } from '@flow/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { EntitiesService } from './entities.service.js';

const creerSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.number().int().positive().nullable(),
  comment: z.string().max(1000).nullable().optional(),
});

const modifierSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  comment: z.string().max(1000).nullable().optional(),
});

@Controller('entities')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequireRight('entity', 'read')
  list(): Promise<EntityRef[]> {
    return this.entities.list();
  }

  @Get(':id')
  @RequireRight('entity', 'read')
  get(@Param('id', ParseIntPipe) id: number): Promise<EntityRef> {
    return this.entities.get(id);
  }

  @Post()
  @RequireRight('entity', 'create')
  create(
    @Body(new ZodValidationPipe(creerSchema)) corps: z.infer<typeof creerSchema>,
  ): Promise<EntityRef> {
    return this.entities.create(corps);
  }

  @Patch(':id')
  @RequireRight('entity', 'update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(modifierSchema)) corps: z.infer<typeof modifierSchema>,
  ): Promise<EntityRef> {
    return this.entities.update(id, corps);
  }

  @Delete(':id')
  @RequireRight('entity', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.entities.remove(id);

    return { ok: true };
  }
}
