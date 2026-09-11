import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from '@flow/db';
import { prefixeExecution, type FileStore } from '@flow/storage';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { FILE_STORE } from '../storage/storage.module.js';

/**
 * Executions purgees par passe.
 *
 * Une borne, parce que chaque ligne coute une suppression de fichiers. Une
 * installation qui active la purge apres deux ans d'historique en a des
 * centaines de milliers a retirer : les traiter d'un bloc tiendrait une
 * transaction pendant des heures, et la base s'en souviendrait longtemps. Les
 * passes suivantes prennent la suite.
 */
const PAR_PASSE = 200;

/**
 * La purge de l'historique.
 *
 * **La duree de conservation se resout en remontant l'arbre.** Une entite qui ne
 * regle rien herite de son parent, jusqu'a la racine ; la racine sans reglage
 * prend celle de l'installation. C'est le sens de la colonne nulle, posee au
 * jalon J1 et que rien ne lisait encore.
 *
 * **Zero desactive la purge**, et c'est un choix legitime -- un historique qui ne
 * s'efface jamais. Il doit s'ecrire plutot que se subir : le defaut est quatre
 * vingt-dix jours, parce qu'un stockage qui grossit sans fin finit par tomber un
 * jour ou personne ne s'y attend.
 */
@Injectable()
export class ExecutionPurgeService {
  private readonly logger = new Logger(ExecutionPurgeService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(FILE_STORE) private readonly stockage: FileStore,
  ) {}

  /**
   * Une passe de purge. Rend le nombre d'executions retirees.
   *
   * Par le role proprietaire : la purge n'a pas de requete, donc pas de
   * perimetre. Lui en donner un -- celui de qui ? -- ne purgerait qu'une branche.
   */
  async passe(): Promise<number> {
    const parDefaut = loadEnv().EXECUTION_RETENTION_DAYS;

    const perimees = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: string }>(sql`
        -- La retention effective de chaque entite : la sienne, sinon celle de
        -- l'ancetre le plus proche qui en declare une, sinon celle de
        -- l'installation.
        --
        -- L'operateur d'ascendance travaille sur l'index GIST des chemins, et
        -- l'ordre par longueur de chemin prend l'ancetre le plus proche : c'est
        -- exactement ce que le chemin materialise rend facile, et ce qu'un
        -- modele a base de caches d'ancetres aurait rendu penible.
        WITH retention AS (
          SELECT
            e.id AS entity_id,
            COALESCE(
              (
                SELECT s.execution_retention_days
                  FROM entity_settings s
                  JOIN entities a ON a.id = s.entity_id
                 WHERE a.path @> e.path
                   AND s.execution_retention_days IS NOT NULL
                 ORDER BY nlevel(a.path) DESC
                 LIMIT 1
              ),
              ${parDefaut}
            ) AS jours
            FROM entities e
        )
        SELECT x.id
          FROM executions x
          JOIN retention r ON r.entity_id = x.entity_id
         WHERE r.jours > 0
           AND x.finished_at IS NOT NULL
           AND x.finished_at < now() - (r.jours || ' days')::interval
         ORDER BY x.finished_at
         LIMIT ${PAR_PASSE}
      `);

      return resultat.rows;
    });

    if (perimees.length === 0) return 0;

    for (const execution of perimees) {
      // **Les fichiers avant la ligne.** Dans l'autre sens, une interruption
      // entre les deux laisserait des fichiers que plus rien ne reference :
      // invisibles, et personne ne les retrouverait jamais. Ici le pire cas est
      // une ligne dont le fichier a disparu -- visible, et rattrapee par la
      // passe suivante.
      try {
        await this.stockage.supprimerPrefixe(prefixeExecution(execution.id));
      } catch (erreur: unknown) {
        this.logger.warn(`Fichiers de ${execution.id} non retires : ${String(erreur)}`);

        continue;
      }

      // Les journaux et les pieces partent en cascade : c'est la contrainte qui
      // l'exprime, et la repeter ici ferait deux verites.
      await this.db.asOwner((tx) =>
        tx.execute(sql`DELETE FROM executions WHERE id = ${execution.id}::uuid`),
      );
    }

    this.logger.log(`Purge : ${String(perimees.length)} execution(s) retiree(s).`);

    return perimees.length;
  }
}
