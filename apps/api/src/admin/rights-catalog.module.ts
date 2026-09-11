import { Module } from '@nestjs/common';
import { RightsCatalogService } from './rights-catalog.service.js';

/**
 * Le catalogue des droits, seul.
 *
 * Un module pour un service sans dependance peut sembler de trop. Il resout
 * pourtant un vrai noeud : l'authentification consulte les plugins -- un
 * annuaire en est un --, les plugins declarent des droits au catalogue, et le
 * catalogue vivait dans un module qui depend de l'authentification. Le sortir
 * casse le cercle sans forwardRef, c'est-a-dire sans demander a NestJS de
 * resoudre a l'execution ce que la structure peut dire a la compilation.
 */
@Module({
  providers: [RightsCatalogService],
  exports: [RightsCatalogService],
})
export class RightsCatalogModule {}
