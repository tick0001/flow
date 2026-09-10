import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  changePasswordSchema,
  loginSchema,
  switchContextSchema,
  type ChangePassword,
  type Login,
  type SessionContext,
  type SwitchContext,
} from '@flow/contracts';
import type { Request, Response } from 'express';
import { cookieSecure, loadEnv } from '../config/env.js';
import { requireContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './context.middleware.js';
import { SessionService } from './session.service.js';
import { AuthenticatedGuard } from './guards/authenticated.guard.js';

/**
 * Options du cookie de session.
 *
 * `httpOnly` : le jeton reste inaccessible au JavaScript de la page, donc une
 * faille d'injection ne l'emporte pas. `sameSite: lax` : le cookie ne part pas
 * sur une requete declenchee par un site tiers, ce qui ferme la falsification de
 * requete inter-sites sans casser le retour depuis un lien externe.
 */
function cookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
} {
  const env = loadEnv();

  return { httpOnly: true, sameSite: 'lax', secure: cookieSecure(env), path: '/' };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) corps: Login,
    @Req() requete: Request,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<SessionContext> {
    const session = await this.auth.login(corps.username, corps.password, {
      userAgent: requete.headers['user-agent'],
      ipAddress: requete.ip,
    });

    reponse.cookie(SESSION_COOKIE, session.cookieValue, cookieOptions());

    return this.auth.describeSession(session);
  }

  /**
   * Etat de la session courante.
   *
   * Appele au chargement de l'interface : c'est lui qui dit si l'on est connecte,
   * ou l'on travaille, et ce que l'on a le droit de faire.
   */
  @Get('session')
  @UseGuards(AuthenticatedGuard)
  async session(): Promise<SessionContext> {
    const context = requireContext();

    return this.auth.describeSession({
      id: context.sessionId,
      userId: context.userId,
      profileId: context.profileId,
      entityId: context.entityId,
      includeSubEntities: context.includeSubEntities,
    });
  }

  @Post('context')
  @UseGuards(AuthenticatedGuard)
  async switchContext(
    @Body(new ZodValidationPipe(switchContextSchema)) corps: SwitchContext,
  ): Promise<SessionContext> {
    const context = requireContext();
    const session = {
      id: context.sessionId,
      userId: context.userId,
      profileId: context.profileId,
      entityId: context.entityId,
      includeSubEntities: context.includeSubEntities,
    };

    await this.auth.switchContext(session, corps);

    // Relu depuis la base plutot que reconstruit a partir de ce qui a ete
    // demande : `includeSubEntities` a pu etre ramene a faux faute
    // d'habilitation recursive, et l'interface doit voir l'etat reel.
    const rafraichie = await this.sessions.resolveById(context.sessionId);

    if (!rafraichie) throw new UnauthorizedException('Session close.');

    return this.auth.describeSession(rafraichie);
  }

  @Post('password')
  @UseGuards(AuthenticatedGuard)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) corps: ChangePassword,
  ): Promise<{ ok: true }> {
    const context = requireContext();

    await this.auth.changePassword(context.userId, corps.currentPassword, corps.newPassword);

    return { ok: true };
  }

  @Post('logout')
  @UseGuards(AuthenticatedGuard)
  async logout(@Res({ passthrough: true }) reponse: Response): Promise<{ ok: true }> {
    const context = requireContext();

    await this.auth.logout(context.sessionId);
    // Les options doivent correspondre a celles de la pose, sinon le navigateur
    // garde le cookie : `path` et `sameSite` font partie de son identite.
    reponse.clearCookie(SESSION_COOKIE, cookieOptions());

    return { ok: true };
  }
}
