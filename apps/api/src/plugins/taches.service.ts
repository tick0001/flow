import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { contextePour } from './contexte.js';
import { PluginHostService } from './hote.service.js';

/**
 * Periode a laquelle on regarde si une tache est due.
 *
 * Un seul minuteur pour toutes les taches, plutot qu'un par tache : les taches
 * vont et viennent avec les plugins, et un minuteur par tache aurait demande de
 * les creer et de les detruire a chaque activation -- avec la fuite qui finit
 * toujours par arriver quand on oublie une destruction.
 */
const CADENCE_MS = 30_000;

/**
 * Les taches de fond des plugins.
 *
 * **Elles tournent sans acteur, et voient donc tout.** Personne ne les a
 * demandees : il n'y a pas de perimetre a poser, et une purge periodique qui ne
 * verrait rien ne purgerait rien. C'est assume, dit dans le SDK et redit dans la
 * note du jalon -- un plugin qui ecrit une tache travaille sur l'installation
 * entiere.
 *
 * Une tache qui deborde n'est **pas relancee en parallele** : le plugin verrait
 * deux exemplaires de lui-meme travailler sur les memes lignes, ce qu'aucun
 * auteur n'attend d'une declaration aussi breve qu'« toutes les heures ».
 */
@Injectable()
export class PluginTasksService implements OnModuleDestroy {
  private readonly logger = new Logger(PluginTasksService.name);

  /** Derniere execution, par plugin et par tache. */
  private readonly derniere = new Map<string, number>();
  /** Taches en cours, pour ne pas les doubler. */
  private readonly enCours = new Set<string>();
  private minuteur: NodeJS.Timeout | undefined;

  constructor(
    private readonly hote: PluginHostService,
    private readonly db: DatabaseService,
  ) {}

  demarrer(): void {
    if (this.minuteur) return;

    this.minuteur = setInterval(() => {
      this.passe();
    }, CADENCE_MS);

    this.minuteur.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Une passe : ce qui est du part, le reste attend. */
  passe(): void {
    const maintenant = Date.now();

    for (const { charge, tache } of this.hote.taches()) {
      const clef = `${charge.manifest.id}:${tache.id}`;

      if (this.enCours.has(clef)) continue;

      const derniere = this.derniere.get(clef);

      // Jamais jouee : on attend une periode avant la premiere fois, plutot que
      // de lancer toutes les taches de tous les plugins au demarrage -- ce qui
      // ferait de chaque redemarrage une rafale.
      if (derniere === undefined) {
        this.derniere.set(clef, maintenant);

        continue;
      }

      if (maintenant - derniere < tache.intervalSeconds * 1000) continue;

      this.derniere.set(clef, maintenant);
      this.enCours.add(clef);

      void this.jouer(clef, charge.manifest.id, charge.schema, tache.run).finally(() => {
        this.enCours.delete(clef);
      });
    }
  }

  private async jouer(
    clef: string,
    pluginId: string,
    schema: string | null,
    run: (contexte: ReturnType<typeof contextePour>) => Promise<void> | void,
  ): Promise<void> {
    const contexte = contextePour(this.db, pluginId, schema, null);

    try {
      await run(contexte);
    } catch (erreur: unknown) {
      this.logger.error(`${clef} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }
}
