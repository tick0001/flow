import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql, withRequestContext, type Database, type Transaction } from '@flow/db';
import { requireContext } from '../common/request-context.js';
import { APP_DB, DB_CONNECTIONS, OWNER_DB } from './database.tokens.js';
import type { Connections } from './database.module.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(APP_DB) private readonly app: Database,
    @Inject(OWNER_DB) private readonly owner: Database,
    @Inject(DB_CONNECTIONS) private readonly connections: Connections,
  ) {}

  /**
   * Transaction du role applicatif, portant le contexte de la requete.
   *
   * C'est la seule voie d'acces pour le code metier. Les parametres de session
   * sont poses par la couche donnees et les politiques de Row-Level Security
   * s'appliquent : aucune requete ecrite ici ne peut sortir du perimetre, meme
   * en SQL brut, meme ecrite par un plugin.
   */
  async asUser<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withRequestContext(this.app, requireContext(), work);
  }

  /**
   * Transaction du role proprietaire, hors Row-Level Security.
   *
   * Reservee aux operations qui **precedent** l'existence d'un contexte :
   * l'authentification, la resolution du perimetre, l'amorcage. Tout autre usage
   * annulerait l'isolation entre entites -- et ne casserait rien, ce qui est
   * exactement le probleme.
   */
  async asOwner<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.owner.transaction(work);
  }

  /**
   * Transaction du role applicatif pour un contexte donne, hors requete HTTP.
   *
   * Le worker en a besoin : une execution appartient a un compte et a une
   * entite, mais elle ne nait pas d'une requete. Il reconstitue donc le contexte
   * depuis la trace d'execution et ecrit sous lui. Ecrire avec le role
   * proprietaire aurait ete plus court, et aurait prive les journaux et les
   * resultats du cloisonnement que tout le reste respecte.
   */
  async asContext<T>(
    context: Parameters<typeof withRequestContext>[1],
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return withRequestContext(this.app, context, work);
  }

  /** La base repond-elle ? Interroge par la sonde de sante. */
  async ping(): Promise<boolean> {
    try {
      await this.owner.execute(sql`SELECT 1`);

      return true;
    } catch (erreur: unknown) {
      this.logger.warn(`PostgreSQL injoignable : ${String(erreur)}`);

      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.connections.owner.close(), this.connections.app.close()]);
  }
}
