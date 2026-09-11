import { Module } from '@nestjs/common';
import { RightsCatalogModule } from '../admin/rights-catalog.module.js';
import { PluginRegistryService } from './registre.service.js';
import { PluginHostService } from './hote.service.js';
import { PluginHooksService } from './hooks.service.js';
import { PluginEventsService } from './evenements.service.js';
import { PluginTasksService } from './taches.service.js';

/**
 * Ce qui fait tourner les plugins, sans rien savoir de l'authentification.
 *
 * La separation a une raison precise : **l'authentification consulte les
 * plugins**. Un annuaire est un plugin, et la connexion lui demande s'il
 * reconnait quelqu'un. Si le runtime dependait du module d'authentification --
 * pour ses gardes, pour son service de droits --, les deux se tiendraient en
 * cercle.
 *
 * Le controleur d'administration des plugins, lui, a bien besoin des gardes : il
 * vit donc dans `PluginsModule`, qui importe les deux.
 */
@Module({
  imports: [RightsCatalogModule],
  providers: [
    PluginRegistryService,
    PluginHostService,
    PluginHooksService,
    PluginEventsService,
    PluginTasksService,
  ],
  exports: [
    PluginRegistryService,
    PluginHostService,
    PluginHooksService,
    PluginEventsService,
    PluginTasksService,
  ],
})
export class PluginRuntimeModule {}
