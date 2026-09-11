import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DirectoryController } from './directory.controller.js';
import { DirectoryRulesService } from './directory.service.js';

/**
 * L'administration des regles d'affectation.
 *
 * Le provisionnement, lui, vit dans le module d'authentification : il s'execute
 * au moment de la connexion, avant que quiconque soit connecte. Les separer
 * evite le cercle -- ce module a besoin des gardes, donc de l'authentification,
 * qui a besoin du provisionnement.
 */
@Module({
  imports: [AuthModule],
  controllers: [DirectoryController],
  providers: [DirectoryRulesService],
})
export class DirectoryModule {}
