import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PluginsController } from './plugins.controller.js';
import { PluginRuntimeModule } from './runtime.module.js';
import { PluginRegistryService } from './registre.service.js';
import { PluginInstallerService } from './installateur.service.js';
import { PluginTasksService } from './taches.service.js';

/**
 * Le module des extensions.
 *
 * Il s'amorce en trois temps, et l'ordre n'est pas negociable : **lire** le
 * disque, **charger** ce qui est installe et actif, **puis** demarrer les
 * taches. Demarrer les taches avant le chargement les ferait tourner a vide ;
 * charger avant d'avoir lu ne trouverait rien.
 *
 * Il porte le controleur d'administration -- qui a besoin des gardes, donc de
 * l'authentification -- et laisse tourner le reste dans `PluginRuntimeModule`,
 * que l'authentification peut importer sans cercle.
 */
@Module({
  imports: [AuthModule, PluginRuntimeModule],
  controllers: [PluginsController],
  providers: [PluginInstallerService],
  exports: [PluginInstallerService, PluginRuntimeModule],
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
