import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createApiKeySchema,
  type ApiKey,
  type CreateApiKey,
  type IssuedApiKey,
} from '@flow/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiKeyService } from '../auth/api-key.service.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';

/**
 * Les clefs d'API.
 *
 * Sous `AuthenticatedGuard` comme le reste : **on ne cree pas une clef avec une
 * clef**. Rien ne l'interdit techniquement -- le contexte est le meme -- mais
 * une clef qui peut en emettre d'autres transforme une fuite unique en fuite
 * permanente, puisque revoquer la premiere ne revoque pas celles qu'elle a
 * creees.
 */
@Controller('apikeys')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class ApiKeysController {
  constructor(private readonly cles: ApiKeyService) {}

  @Get()
  @RequireRight('apikey', 'read')
  list(): Promise<ApiKey[]> {
    return this.cles.list();
  }

  /**
   * Emet une clef.
   *
   * Le secret n'est rendu **qu'ici**, une seule fois. Il n'est nulle part
   * ailleurs : ni dans la liste, ni dans un detail, ni en base autrement que
   * sous forme de condensat.
   */
  @Post()
  @RequireRight('apikey', 'create')
  create(
    @Body(new ZodValidationPipe(createApiKeySchema)) corps: CreateApiKey,
  ): Promise<IssuedApiKey> {
    return this.cles.issue(corps.name, corps.expiresInDays);
  }

  @Delete(':id')
  @RequireRight('apikey', 'delete')
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.cles.revoke(id);

    return { ok: true };
  }
}
