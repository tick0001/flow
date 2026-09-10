import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ContextMiddleware } from './context.middleware.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { RightsService } from './rights.service.js';
import { ScopeService } from './scope.service.js';
import { SessionService } from './session.service.js';
import { AuthenticatedGuard } from './guards/authenticated.guard.js';
import { RightsGuard } from './guards/rights.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    ScopeService,
    RightsService,
    LoginThrottleService,
    AuthenticatedGuard,
    RightsGuard,
  ],
  exports: [AuthService, PasswordService, ScopeService, RightsService, SessionService],
})
export class AuthModule implements NestModule {
  /**
   * Le middleware s'applique a TOUTES les routes, y compris publiques.
   *
   * Il n'autorise rien : il se contente d'etablir le contexte quand une session
   * valide existe. Le limiter aux routes protegees obligerait a tenir une liste
   * a jour, et un oubli produirait une route qui s'execute sans perimetre --
   * donc sans isolation.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes('*path');
  }
}
