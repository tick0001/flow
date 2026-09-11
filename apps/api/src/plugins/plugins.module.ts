import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { PluginsController } from './plugins.controller.js';
import { PluginRegistryService } from './registre.service.js';
import { PluginHostService } from './hote.service.js';
import { PluginInstallerService } from './installateur.service.js';
import { PluginHooksService } from './hooks.service.js';
import { PluginEventsService } from './evenements.service.js';
import { PluginTasksService } from './taches.service.js';

/**
 * Le module des extensions.
 *
 * Il s'amorce en trois temps, et l'ordre n'est pas negociable : **lire** le
 * disque, **charger** ce qui est installe et actif, **puis** demarrer les
 * taches. Demarrer les taches avant le chargement les ferait tourner a vide ;
 * charger avant d'avoir lu ne trouverait rien.
 *
 * Il exporte le bus des hooks, et lui seul. Le reste -- registre, hote,
 * installateur -- ne concerne que l'administration des plugins ; les modules du
 * coeur n'ont a connaitre que le point ou ils demandent leur avis aux plugins.
 */
@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [PluginsController],
  providers: [
    PluginRegistryService,
    PluginHostService,
    PluginInstallerService,
    PluginHooksService,
    PluginEventsService,
    PluginTasksService,
  ],
  exports: [PluginHooksService, PluginHostService, PluginInstallerService, PluginRegistryService],
})
export class PluginsModule implements OnModuleInit {
  private readonly logger = new Logger(PluginsModule.name);

  constructor(
    private readonly registre: PluginRegistryService,
    private readonly installateur: PluginInstallerService,
    private readonly taches: PluginTasksService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.registre.relire();

    try {
      await this.installateur.chargerLesActifs();
    } catch (erreur: unknown) {
      // Une installation entiere ne reste pas a terre parce qu'une extension
      // est cassee : le detail est deja journalise par plugin, ce filet ne
      // couvre que l'imprevu -- une base injoignable a l'amorcage, par exemple.
      this.logger.error(`Chargement des plugins interrompu : ${String(erreur)}`);
    }

    this.taches.demarrer();
  }
}
