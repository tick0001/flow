import {
  createDatabase,
  executionArtifacts,
  inArray,
  executionLogs,
  executions,
  sql,
  withRequestContext,
  type Connection,
  type RequestContext,
} from '@flow/db';
import type { ArtifactKind, ExecutionStatus, LogLevel } from '@flow/contracts';
import { loadEnv } from './config/env.js';
import { journalDe } from './log.js';

const log = journalDe('Depot');

/** Ce qu'une reclamation reussie apprend au worker. */
export interface ExecutionReclamee {
  id: string;
  botId: string;
  parameters: Record<string, unknown>;
  headed: boolean;
  /** Contexte reconstitue, pour ecrire sous le meme cloisonnement que l'API. */
  context: RequestContext;
}

export interface LigneDeJournal {
  seq: number;
  at: Date;
  level: LogLevel;
  message: string;
}

export interface Denouement {
  status: ExecutionStatus;
  message: string | null;
  output: Record<string, unknown> | null;
  durationMs: number;
}

/**
 * Tout ce que le worker fait a la base, et la frontiere entre ses deux roles.
 *
 * **Le role proprietaire** ne sert qu'a ce qui precede l'existence d'un contexte :
 * reclamer une execution -- on ne connait ni son entite ni son demandeur avant de
 * l'avoir lue -- et battre le coeur, qui porte sur les executions de plusieurs
 * comptes a la fois.
 *
 * **Le role applicatif** porte tout le reste : journaux, progression, denouement.
 * Le worker reconstitue le contexte depuis la trace et ecrit sous lui. Ecrire le
 * tout avec le role proprietaire aurait ete plus court de trois lignes, et aurait
 * prive les journaux et les resultats du cloisonnement que tout le reste de
 * l'application respecte -- y compris contre un bug du worker lui-meme.
 */
export class Depot {
  private readonly owner: Connection;
  private readonly app: Connection;

  constructor(private readonly workerId: string) {
    const env = loadEnv();

    // Le pool proprietaire reste petit : il ne porte que la reclamation et le
    // battement de coeur, qui sont brefs et rares au regard d'un run.
    this.owner = createDatabase({ connectionString: env.DATABASE_URL, max: 2 });
    this.app = createDatabase({
      connectionString: env.DATABASE_APP_URL,
      // Deux connexions par execution simultanee : une pour le journal qui se
      // vide, une pour la progression ou le denouement qui arrive en meme temps.
      max: Math.max(4, env.WORKER_CONCURRENCY * 2),
    });
  }

  /**
   * Reclame une execution : la fait passer de `queued` a `running`, ou rend null.
   *
   * La condition `status = 'queued'` fait tout le travail, et elle ferme trois
   * portes d'un coup :
   *
   *  - **deux workers sur le meme travail** : le second ne trouve aucune ligne ;
   *  - **une annulation arrivee avant le demarrage** : l'API a deja pose
   *    `cancelled`, donc plus rien a reclamer ;
   *  - **un travail redistribue apres la mort d'un worker** -- ce que BullMQ fait
   *    de lui-meme pour un travail bloque : l'execution est encore `running`, et
   *    la reclamation echoue. C'est ce qui empeche un bot de tourner deux fois
   *    parce qu'une machine a redemarre, et cela compte : un bot remplit des
   *    formulaires et clique sur des boutons.
   *
   * Le chemin de l'entite est lu dans la meme requete. Le perimetre reconstitue
   * est **cette entite exactement**, sans sa descendance : le worker n'a rien a
   * lire ni a ecrire ailleurs que sur l'execution qu'il tient.
   */
  async reclamer(executionId: string): Promise<ExecutionReclamee | null> {
    const lignes = await this.owner.db.transaction(async (tx) => {
      const resultat = await tx.execute<{
        id: string;
        botId: string;
        parameters: Record<string, unknown>;
        headed: boolean;
        userId: number;
        profileId: number;
        entityPath: string;
      }>(sql`
        UPDATE executions x
           SET status = 'running',
               worker_id = ${this.workerId},
               started_at = now(),
               heartbeat_at = now()
         WHERE x.id = ${executionId}::uuid
           AND x.status = 'queued'
        RETURNING
          x.id                AS "id",
          x.bot_id            AS "botId",
          x.parameters        AS "parameters",
          x.headed            AS "headed",
          x.requested_by      AS "userId",
          x.profile_id        AS "profileId",
          (SELECT e.path::text FROM entities e WHERE e.id = x.entity_id) AS "entityPath"
      `);

      return resultat.rows;
    });

    const ligne = lignes[0];

    if (!ligne) return null;

    return {
      id: ligne.id,
      botId: ligne.botId,
      parameters: ligne.parameters,
      headed: ligne.headed,
      context: {
        userId: ligne.userId,
        profileId: ligne.profileId,
        entityPath: ligne.entityPath,
        scope: { subtreePaths: [], exactPaths: [ligne.entityPath] },
      },
    };
  }

  /** Ecrit un paquet de lignes de journal, sous le contexte de l'execution. */
  async journaliser(
    context: RequestContext,
    executionId: string,
    lignes: LigneDeJournal[],
  ): Promise<void> {
    if (lignes.length === 0) return;

    await withRequestContext(this.app.db, context, (tx) =>
      tx.insert(executionLogs).values(
        lignes.map((ligne) => ({
          executionId,
          seq: ligne.seq,
          at: ligne.at,
          level: ligne.level,
          message: ligne.message,
        })),
      ),
    );
  }

  /**
   * Enregistre l'etape en cours.
   *
   * Ecrasee a chaque fois, jamais accumulee : la progression est un etat, pas un
   * historique -- et l'historique des etapes, c'est le journal.
   */
  async progresser(
    context: RequestContext,
    executionId: string,
    step: string,
    percent: number | null,
  ): Promise<void> {
    await withRequestContext(this.app.db, context, (tx) =>
      tx.execute(sql`
        UPDATE executions
           SET progress_step = ${step},
               progress_percent = ${percent}
         WHERE id = ${executionId}::uuid
      `),
    );
  }

  /**
   * Bat le coeur des executions detenues, et rapporte celles dont on demande
   * l'interruption.
   *
   * Les deux dans la meme requete, et ce n'est pas une economie : la diffusion
   * Redis est le chemin **rapide** de l'annulation, celui-ci est le chemin
   * **fiable**. Un worker qui n'ecoutait pas au bon moment -- redemarre, ou
   * reconnecte apres une coupure -- voit la demande ici, au plus tard un battement
   * apres. Sans ce second chemin, une annulation perdue laisserait un bot tourner
   * jusqu'a sa fin naturelle sans que personne ne puisse plus rien.
   */
  async battre(executionIds: string[]): Promise<string[]> {
    if (executionIds.length === 0) return [];

    const lignes = await this.owner.db.transaction(async (tx) =>
      tx
        .update(executions)
        .set({ heartbeatAt: sql`now()` })
        .where(inArray(executions.id, executionIds))
        .returning({ id: executions.id, cancelRequestedAt: executions.cancelRequestedAt }),
    );

    return lignes.filter((ligne) => ligne.cancelRequestedAt !== null).map((ligne) => ligne.id);
  }

  /**
   * Enregistre une piece deja ecrite dans le stockage.
   *
   * Sous le contexte de l'execution, comme le journal : une piece est aussi
   * cloisonnee que la trace a laquelle elle appartient, et une capture d'ecran
   * de page authentifiee est ce qu'on veut le moins voir fuiter.
   */
  async enregistrerPiece(
    context: RequestContext,
    piece: {
      id: string;
      executionId: string;
      kind: ArtifactKind;
      name: string;
      contentType: string;
      sizeBytes: number;
      storageKey: string;
    },
  ): Promise<void> {
    await withRequestContext(this.app.db, context, (tx) =>
      tx.insert(executionArtifacts).values(piece),
    );
  }

  /**
   * Pose le denouement : c'est la derniere ecriture d'une execution.
   *
   * `worker_id` est conserve. Une execution terminee doit encore dire **ou** elle
   * a tourne -- c'est la premiere question quand un echec ne se reproduit que sur
   * une machine.
   */
  async terminer(
    context: RequestContext,
    executionId: string,
    denouement: Denouement,
  ): Promise<void> {
    await withRequestContext(this.app.db, context, (tx) =>
      tx.execute(sql`
        UPDATE executions
           SET status = ${denouement.status}::execution_status,
               message = ${denouement.message},
               output = ${denouement.output === null ? null : JSON.stringify(denouement.output)}::jsonb,
               duration_ms = ${denouement.durationMs},
               finished_at = now()
         WHERE id = ${executionId}::uuid
      `),
    );
  }

  /**
   * Denouement pose avec le role proprietaire, hors politiques.
   *
   * Un seul usage : l'arret du worker, ou il faut marquer `abandoned` des
   * executions dont le contexte peut deja avoir ete perdu -- une reclamation qui
   * a reussi juste avant le signal, par exemple. Le faire sous contexte
   * echouerait alors silencieusement et laisserait l'execution `running` pour
   * toujours, ce que l'arret propre existe justement pour eviter.
   */
  async terminerSansContexte(executionId: string, denouement: Denouement): Promise<void> {
    await this.owner.db.transaction((tx) =>
      tx.execute(sql`
        UPDATE executions
           SET status = ${denouement.status}::execution_status,
               message = ${denouement.message},
               duration_ms = ${denouement.durationMs},
               finished_at = now()
         WHERE id = ${executionId}::uuid
           AND status = 'running'
      `),
    );
  }

  async fermer(): Promise<void> {
    log.debug('Fermeture des connexions a la base.');
    await Promise.all([this.owner.close(), this.app.close()]);
  }
}
