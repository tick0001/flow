import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isTerminal,
  type ExecutionDetail,
  type ExecutionLog,
  type ExecutionLogsQuery,
  type ExecutionStatus,
  type ExecutionSummary,
  type ExecutionsQuery,
  type LogLevel,
  type RightScope,
  type StartExecution,
} from '@flow/contracts';
import { executions, sql, type SQL } from '@flow/db';
import { displayNameOf } from '../common/display-name.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { BotRegistryService } from '../bots/bot-registry.service.js';
import { ParameterValidatorService } from '../bots/parameter-validator.service.js';
import { QueueService } from '../queue/queue.service.js';

/**
 * Une ligne telle que la requete la rend.
 *
 * Les noms sont ceux des alias SQL : la requete joint `entities` et `users`, et
 * un objet imbrique ne se construit pas en SQL. L'assemblage se fait dans
 * `resumer`, une fois.
 */
interface LigneExecution extends Record<string, unknown> {
  id: string;
  botId: string;
  botName: string;
  botVersion: string;
  status: ExecutionStatus;
  headed: boolean;
  entityId: number;
  entityName: string;
  requestedById: number;
  firstName: string | null;
  lastName: string | null;
  username: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  message: string | null;
  progressStep: string | null;
  progressPercent: number | null;
  cancelRequestedAt: Date | null;
  workerId: string | null;
  parameters: Record<string, unknown>;
  output: Record<string, unknown> | null;
}

/** Colonnes communes a la liste et au detail. Ecrites une fois. */
const COLONNES = sql`
  x.id                  AS "id",
  x.bot_id              AS "botId",
  x.bot_name            AS "botName",
  x.bot_version         AS "botVersion",
  x.status              AS "status",
  x.headed              AS "headed",
  x.entity_id           AS "entityId",
  e.name                AS "entityName",
  x.requested_by        AS "requestedById",
  u.first_name          AS "firstName",
  u.last_name           AS "lastName",
  u.username            AS "username",
  x.created_at          AS "createdAt",
  x.started_at          AS "startedAt",
  x.finished_at         AS "finishedAt",
  x.duration_ms         AS "durationMs",
  x.message             AS "message",
  x.progress_step       AS "progressStep",
  x.progress_percent    AS "progressPercent",
  x.cancel_requested_at AS "cancelRequestedAt",
  x.worker_id           AS "workerId",
  x.parameters          AS "parameters",
  x.output              AS "output"
`;

/**
 * Encodage du curseur de pagination.
 *
 * Il porte les deux colonnes du tri, parce que l'une ne suffit pas : deux
 * executions lancees dans la meme milliseconde -- ce qui arrive des qu'on
 * declenche en rafale -- rendraient la place du curseur ambigue, et une ligne
 * serait sautee ou servie deux fois.
 *
 * Opaque a dessein : un client qui le decomposerait dependrait des colonnes du
 * tri, qu'on doit pouvoir changer.
 */
function encoderCurseur(ligne: { createdAt: Date; id: string }): string {
  return Buffer.from(`${ligne.createdAt.toISOString()}|${ligne.id}`).toString('base64url');
}

function decoderCurseur(curseur: string): { createdAt: string; id: string } | null {
  const [date, id] = Buffer.from(curseur, 'base64url').toString('utf8').split('|');

  if (!date || !id) return null;

  return { createdAt: date, id };
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registre: BotRegistryService,
    private readonly parametres: ParameterValidatorService,
    private readonly rights: RightsService,
    private readonly file: QueueService,
  ) {}

  /**
   * Lance un bot : une trace en base, un travail en file, et c'est tout.
   *
   * **L'ordre des deux ecritures n'est pas interchangeable.** La ligne est
   * ecrite et validee d'abord, le travail publie ensuite. Publier en premier
   * ouvrirait une fenetre pendant laquelle un worker depile un travail dont la
   * ligne n'est pas encore visible -- il concluerait a une execution inexistante
   * et la jetterait. Dans ce sens-ci, le pire cas est une ligne `queued` sans
   * travail, que la reconciliation remet en file.
   */
  async start(demande: StartExecution): Promise<ExecutionSummary> {
    const context = requireContext();
    const bot = this.registre.get(demande.botId);

    if (!bot) throw new NotFoundException("Ce bot n'existe pas sur cette installation.");

    if (!bot.loaded) {
      // Le motif du refus est deja calcule par le registre et deja affiche sur la
      // carte du bot : le reprendre ici evite deux formulations du meme fait.
      throw new ConflictException(bot.loadError ?? 'Ce bot est refuse par cette installation.');
    }

    const parametres = this.parametres.valider(bot.manifest, demande.parameters);

    const [creee] = await this.db.asUser((tx) =>
      tx
        .insert(executions)
        .values({
          botId: bot.manifest.id,
          // Recopies, jamais relus au registre a l'affichage : la trace doit
          // dire quelle version a tourne, meme apres une mise a jour du bot.
          botName: bot.manifest.name,
          botVersion: bot.manifest.version,
          parameters: parametres,
          headed: demande.headed,
          entityId: context.entityId,
          requestedBy: context.userId,
          profileId: context.profileId,
        })
        .returning({ id: executions.id }),
    );

    if (!creee) throw new ConflictException("L'execution n'a pas pu etre creee.");

    try {
      await this.file.enqueue({ executionId: creee.id, botId: bot.manifest.id });
    } catch (erreur: unknown) {
      // Redis injoignable. La ligne reste `queued` : la reconciliation la
      // remettra en file des que la file repond. On le journalise sans echouer,
      // parce qu'echouer ferait croire que rien n'a ete enregistre -- alors que
      // l'execution existe et partira.
      this.logger.error(`Mise en file impossible pour ${creee.id} : ${String(erreur)}`);
    }

    return this.get(creee.id);
  }

  /** Une page d'executions, de la plus recente a la plus ancienne. */
  async list(
    requete: ExecutionsQuery,
  ): Promise<{ items: ExecutionSummary[]; nextCursor: string | null }> {
    const context = requireContext();
    const conditions = [await this.restrictionDePortee()];

    if (requete.botId) conditions.push(sql`x.bot_id = ${requete.botId}`);
    if (requete.status) conditions.push(sql`x.status = ${requete.status}::execution_status`);
    if (requete.mine) conditions.push(sql`x.requested_by = ${context.userId}`);

    if (requete.cursor) {
      const curseur = decoderCurseur(requete.cursor);

      // Un curseur illisible est ignore plutot que refuse : il vient d'un lien
      // partage ou d'un onglet reste ouvert, et rendre la premiere page est plus
      // utile qu'une erreur.
      if (curseur) {
        conditions.push(
          sql`(x.created_at, x.id) < (${curseur.createdAt}::timestamptz, ${curseur.id}::uuid)`,
        );
      }
    }

    // Une ligne de plus que demande : c'est ce qui dit s'il y a une page
    // suivante, sans un COUNT(*) sur une table qui n'arrete pas de grossir.
    const lignes = await this.interroger(conditions, requete.limit + 1);
    const page = lignes.slice(0, requete.limit);
    const suite = lignes.length > requete.limit ? page[page.length - 1] : undefined;

    return {
      items: await this.resumerTous(page),
      nextCursor: suite ? encoderCurseur(suite) : null,
    };
  }

  async get(id: string): Promise<ExecutionDetail> {
    const ligne = await this.lire(id);
    const [resume] = await this.resumerTous([ligne]);

    if (!resume) throw new NotFoundException("Cette execution n'existe pas.");

    return {
      ...resume,
      parameters: ligne.parameters,
      output: ligne.output,
      worker: ligne.workerId,
      cancelRequested: ligne.cancelRequestedAt !== null && !isTerminal(ligne.status),
    };
  }

  /**
   * Les lignes de journal qui suivent un rang.
   *
   * L'execution est relue d'abord, et pour une raison de forme : la politique de
   * Row-Level Security rendrait deja une liste vide pour une execution
   * invisible, ce qui se lit comme « pas encore de journal » alors que c'est
   * « pas pour vous ». Un 404 dit la bonne chose.
   */
  async logs(id: string, requete: ExecutionLogsQuery): Promise<ExecutionLog[]> {
    await this.lire(id);

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{
        seq: number;
        at: Date;
        level: LogLevel;
        message: string;
      }>(sql`
        SELECT seq, at, level, message
          FROM execution_logs
         WHERE execution_id = ${id}::uuid
           AND seq > ${requete.afterSeq}
         ORDER BY seq
         LIMIT ${requete.limit}
      `);

      return resultat.rows;
    });

    return lignes.map((ligne) => ({ executionId: id, ...ligne }));
  }

  /**
   * Demande l'interruption d'une execution.
   *
   * Deux cas, et un seul aller-retour avec la base pour les distinguer : une
   * execution encore en file n'a pas de worker, on la termine donc sur place ;
   * une execution en cours appartient a un worker, a qui l'on transmet la
   * demande.
   *
   * La mise a jour conditionnelle fait office d'arbitre. Si un worker reclame
   * l'execution au meme instant, l'un des deux perd : soit le `WHERE status =
   * queued` ne trouve rien -- le worker a gagne, on diffuse --, soit la reclame
   * du worker ne trouve rien et il passe son chemin. Comparer l'etat puis agir
   * en deux temps aurait laisse les deux gagner.
   */
  async cancel(id: string): Promise<ExecutionDetail> {
    const ligne = await this.lire(id);

    if (isTerminal(ligne.status)) {
      throw new ConflictException('Cette execution est deja terminee.');
    }

    await this.verifierPorteeSurLAuteur(ligne.requestedById);

    const [annulee] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ id: string }>(sql`
        UPDATE executions
           SET status = 'cancelled',
               cancel_requested_at = now(),
               finished_at = now()
         WHERE id = ${id}::uuid
           AND status = 'queued'
        RETURNING id
      `);

      return resultat.rows;
    });

    if (annulee) {
      // Elle n'a jamais demarre : ni duree, ni message. Le statut et l'absence de
      // `startedAt` disent tout, et un message francais en base serait lu par
      // quelqu'un qui travaille en anglais.
      await this.file.remove(id);

      return this.get(id);
    }

    // Elle tourne. L'intention est ecrite avant d'etre diffusee : un worker qui
    // redemarre la relit, un worker qui n'ecoutait pas la voit a son battement.
    await this.db.asUser((tx) =>
      tx.execute(sql`
        UPDATE executions
           SET cancel_requested_at = COALESCE(cancel_requested_at, now())
         WHERE id = ${id}::uuid
      `),
    );

    await this.file.publishCancel(id);

    return this.get(id);
  }

  // --- interne ---------------------------------------------------------------

  private async lire(id: string): Promise<LigneExecution> {
    const [ligne] = await this.interroger(
      [await this.restrictionDePortee(), sql`x.id = ${id}::uuid`],
      1,
    );

    // Invisible et inexistante rendent la meme reponse : distinguer les deux
    // confirmerait l'existence d'une execution d'une autre organisation.
    if (!ligne) throw new NotFoundException("Cette execution n'existe pas.");

    return ligne;
  }

  private async interroger(conditions: SQL[], limite: number): Promise<LigneExecution[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LigneExecution>(sql`
        SELECT ${COLONNES}
          FROM executions x
          JOIN entities e ON e.id = x.entity_id
          JOIN users u ON u.id = x.requested_by
         WHERE ${sql.join(conditions, sql` AND `)}
         ORDER BY x.created_at DESC, x.id DESC
         LIMIT ${limite}
      `);

      return resultat.rows;
    });
  }

  /**
   * Ce que la portee du droit retire, en plus de ce que le cloisonnement retire
   * deja.
   *
   * Le Row-Level Security borne la lecture au perimetre de travail : c'est
   * l'enveloppe extérieure, et rien n'en sort. La portee du droit resserre a
   * l'interieur -- `own` aux siennes, `entity` a l'entite active sans sa
   * descendance. `recursive` et `all` n'ajoutent rien : le perimetre est deja
   * leur plafond, et ecrire une clause qui ne filtre rien laisserait croire
   * qu'elle protege quelque chose.
   */
  private async restrictionDePortee(): Promise<SQL> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'execution', 'read');

    if (portee === 'own') return sql`x.requested_by = ${context.userId}`;
    if (portee === 'entity') return sql`x.entity_id = ${context.entityId}`;

    return sql`true`;
  }

  /** Refuse une interruption que la portee du droit ne couvre pas. */
  private async verifierPorteeSurLAuteur(auteur: number): Promise<void> {
    const context = requireContext();
    const portee: RightScope | undefined = await this.rights.scopeFor(
      context.profileId,
      'execution',
      'cancel',
    );

    if (portee === 'own' && auteur !== context.userId) {
      throw new ForbiddenException("Ce droit ne permet d'interrompre que vos propres executions.");
    }
  }

  private async resumerTous(lignes: LigneExecution[]): Promise<ExecutionSummary[]> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'execution', 'cancel');

    return lignes.map((ligne) => ({
      id: ligne.id,
      botId: ligne.botId,
      botName: ligne.botName,
      botVersion: ligne.botVersion,
      status: ligne.status,
      headed: ligne.headed,
      entity: { id: ligne.entityId, name: ligne.entityName },
      requestedBy: { id: ligne.requestedById, displayName: displayNameOf(ligne) },
      createdAt: ligne.createdAt,
      startedAt: ligne.startedAt,
      finishedAt: ligne.finishedAt,
      durationMs: ligne.durationMs,
      message: ligne.message,
      progress:
        ligne.progressStep === null
          ? null
          : { step: ligne.progressStep, percent: ligne.progressPercent },
      // Le droit, sa portee et l'etat, croises ici une fois pour que l'interface
      // n'ait pas a refaire ce raisonnement -- ni a se tromper autrement que le
      // serveur.
      canCancel:
        portee !== undefined &&
        !isTerminal(ligne.status) &&
        (portee !== 'own' || ligne.requestedById === context.userId),
    }));
  }
}
