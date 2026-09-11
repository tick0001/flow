import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isTerminal,
  type ExecutionArtifact,
  type ExecutionDetail,
  type ExecutionLog,
  type ExecutionLogsQuery,
  type ExecutionSummary,
  type ExecutionsQuery,
  type RightScope,
  type StartExecution,
} from '@flow/contracts';
import {
  and,
  asc,
  desc,
  entities,
  eq,
  executionArtifacts,
  executionLogs,
  executions,
  gt,
  gte,
  ilike,
  lte,
  sql,
  users,
  type SQL,
} from '@flow/db';
import { displayNameOf } from '../common/display-name.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { BotRegistryService } from '../bots/bot-registry.service.js';
import { ParameterValidatorService } from '../bots/parameter-validator.service.js';
import { QueueService } from '../queue/queue.service.js';
import { ExecutionRelayService } from './relais.service.js';

/**
 * Les colonnes que la liste et le detail lisent, declarees une fois.
 *
 * La projection passe par le constructeur de requetes et non par du SQL brut, et
 * ce n'est pas une affaire de gout : **Drizzle desactive l'analyseur de types de
 * node-postgres pour les dates**, ses propres mappeurs s'en chargeant. Une
 * requete brute rend donc `created_at` sous forme de chaine au format
 * PostgreSQL, pendant que TypeScript croit tenir une `Date`. Le curseur de
 * pagination appelle `toISOString()` dessus : ecrit en SQL brut, il echouait a la
 * deuxieme page -- et seulement a la deuxieme page, c'est-a-dire jamais avant la
 * cinquante-unieme execution.
 */
const PROJECTION = {
  id: executions.id,
  botId: executions.botId,
  botName: executions.botName,
  botVersion: executions.botVersion,
  status: executions.status,
  headed: executions.headed,
  entityId: executions.entityId,
  entityName: entities.name,
  requestedById: executions.requestedBy,
  firstName: users.firstName,
  lastName: users.lastName,
  username: users.username,
  createdAt: executions.createdAt,
  startedAt: executions.startedAt,
  finishedAt: executions.finishedAt,
  durationMs: executions.durationMs,
  message: executions.message,
  progressStep: executions.progressStep,
  progressPercent: executions.progressPercent,
  cancelRequestedAt: executions.cancelRequestedAt,
  workerId: executions.workerId,
  scheduleId: executions.scheduleId,
  parameters: executions.parameters,
  output: executions.output,
};

/**
 * Les gravites egales ou superieures a chacune, ecrites une fois.
 *
 * Un tableau litteral plutot qu'une comparaison sur l'enumere : PostgreSQL sait
 * ordonner un type enumere, mais l'ordre depend alors de l'ordre de declaration
 * du type -- une information qui vit dans une migration, loin d'ici, et qu'un
 * `ALTER TYPE ... ADD VALUE` peut changer sans que personne ne relise ce fichier.
 */
export const GRAVITES_A_PARTIR_DE: Record<string, string> = {
  debug: '{debug,info,warning,error}',
  info: '{info,warning,error}',
  warning: '{warning,error}',
  error: '{error}',
};

/**
 * Echappe ce qui a un sens dans un motif `LIKE`.
 *
 * Sans cela, chercher « 100% » dans les journaux rendrait toutes les lignes : le
 * pourcentage y signifie « n'importe quoi ». Le contresens est silencieux, ce qui
 * est le pire genre.
 */
export function echapperLike(motif: string): string {
  return motif.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

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

/**
 * La requete de lecture, hors de la classe.
 *
 * Dehors pour une raison de typage : c'est de son type de retour que
 * `LigneExecution` est deduit, et une methode de la classe s'y refererait
 * circulairement. Le type de la ligne suit donc la projection tout seul -- une
 * colonne ajoutee a `PROJECTION` apparait partout sans qu'on redecrive rien.
 */
async function interroger(db: DatabaseService, conditions: SQL[], limite: number) {
  return db.asUser((tx) =>
    tx
      .select(PROJECTION)
      .from(executions)
      // Des jointures internes et non externes : une execution a toujours une
      // entite et un demandeur, tous deux en cle etrangere non nulle. Une
      // jointure externe laisserait croire le contraire, et obligerait a traiter
      // partout un cas qui ne peut pas arriver.
      .innerJoin(entities, eq(entities.id, executions.entityId))
      .innerJoin(users, eq(users.id, executions.requestedBy))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(executions.createdAt), desc(executions.id))
      .limit(limite),
  );
}

type LigneExecution = Awaited<ReturnType<typeof interroger>>[number];

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registre: BotRegistryService,
    private readonly parametres: ParameterValidatorService,
    private readonly rights: RightsService,
    private readonly file: QueueService,
    private readonly relais: ExecutionRelayService,
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
    const conditions: SQL[] = [];
    const portee = await this.restrictionDePortee();

    if (portee) conditions.push(portee);
    if (requete.botId) conditions.push(eq(executions.botId, requete.botId));
    if (requete.scheduleId) conditions.push(eq(executions.scheduleId, requete.scheduleId));
    if (requete.status) conditions.push(eq(executions.status, requete.status));
    if (requete.mine) conditions.push(eq(executions.requestedBy, context.userId));
    if (requete.depuis) conditions.push(gte(executions.createdAt, requete.depuis));
    if (requete.jusqua) conditions.push(lte(executions.createdAt, requete.jusqua));

    if (requete.cursor) {
      const curseur = decoderCurseur(requete.cursor);

      // Un curseur illisible est ignore plutot que refuse : il vient d'un lien
      // partage ou d'un onglet reste ouvert, et rendre la premiere page est plus
      // utile qu'une erreur.
      if (curseur) {
        conditions.push(
          sql`(${executions.createdAt}, ${executions.id}) < (${curseur.createdAt}::timestamptz, ${curseur.id}::uuid)`,
        );
      }
    }

    // Une ligne de plus que demande : c'est ce qui dit s'il y a une page
    // suivante, sans un COUNT(*) sur une table qui n'arrete pas de grossir.
    const lignes = await interroger(this.db, conditions, requete.limit + 1);
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
      artifacts: await this.pieces(id),
    };
  }

  /**
   * Les pieces d'une execution : capture, trace, fichiers deposes.
   *
   * La clef de stockage n'est **pas** rendue. Le client demande une piece par son
   * identifiant, sur une route qui verifie le cloisonnement : publier le chemin
   * l'aurait rendu devinable et aurait contourne tout le reste.
   */
  async pieces(executionId: string): Promise<ExecutionArtifact[]> {
    return this.db.asUser((tx) =>
      tx
        .select({
          id: executionArtifacts.id,
          kind: executionArtifacts.kind,
          name: executionArtifacts.name,
          contentType: executionArtifacts.contentType,
          sizeBytes: executionArtifacts.sizeBytes,
          createdAt: executionArtifacts.createdAt,
        })
        .from(executionArtifacts)
        .where(eq(executionArtifacts.executionId, executionId))
        .orderBy(asc(executionArtifacts.createdAt)),
    );
  }

  /**
   * Une piece et sa clef, pour la servir.
   *
   * La lecture passe par le role applicatif : la politique de la table exige que
   * l'execution soit dans le perimetre. Une piece invisible est donc introuvable,
   * et le 404 ne distingue pas les deux -- le distinguer confirmerait l'existence
   * d'une capture appartenant a une autre organisation.
   */
  async pieceAServir(
    executionId: string,
    artifactId: string,
  ): Promise<{ name: string; contentType: string; sizeBytes: number; storageKey: string }> {
    const [piece] = await this.db.asUser((tx) =>
      tx
        .select({
          name: executionArtifacts.name,
          contentType: executionArtifacts.contentType,
          sizeBytes: executionArtifacts.sizeBytes,
          storageKey: executionArtifacts.storageKey,
        })
        .from(executionArtifacts)
        .where(
          and(
            eq(executionArtifacts.id, artifactId),
            eq(executionArtifacts.executionId, executionId),
          ),
        ),
    );

    if (!piece) throw new NotFoundException("Cette piece n'existe pas.");

    return piece;
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

    const conditions: SQL[] = [
      eq(executionLogs.executionId, id),
      gt(executionLogs.seq, requete.afterSeq),
    ];

    if (requete.level) {
      // Les niveaux forment une echelle : « a partir de l'avertissement » a donc
      // un sens, et se traduit par une comparaison sur leur rang. C'est
      // exactement la raison pour laquelle il n'y a pas de niveau `success`.
      conditions.push(
        sql`${executionLogs.level} = ANY (${GRAVITES_A_PARTIR_DE[requete.level]}::log_level[])`,
      );
    }

    if (requete.search) {
      // `ILIKE` et non `lower(...) LIKE lower(...)` : la classe d'operateurs
      // trigramme sert directement l'insensibilite a la casse, et l'index pose
      // sur `message` suffit -- verifie au plan. L'ecriture en `lower()` aurait
      // demande un second index sur la table qui grossit le plus vite du schema.
      conditions.push(ilike(executionLogs.message, `%${echapperLike(requete.search)}%`));
    }

    const lignes = await this.db.asUser((tx) =>
      tx
        .select({
          seq: executionLogs.seq,
          at: executionLogs.at,
          level: executionLogs.level,
          message: executionLogs.message,
        })
        .from(executionLogs)
        .where(and(...conditions))
        .orderBy(asc(executionLogs.seq))
        .limit(requete.limit),
    );

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
   * l'execution au meme instant, l'un des deux perd : soit le `status = queued`
   * ne trouve rien -- le worker a gagne, on diffuse --, soit la reclamation du
   * worker ne trouve rien et il passe son chemin. Comparer l'etat puis agir en
   * deux temps aurait laisse les deux gagner.
   */
  async cancel(id: string): Promise<ExecutionDetail> {
    const ligne = await this.lire(id);

    if (isTerminal(ligne.status)) {
      throw new ConflictException('Cette execution est deja terminee.');
    }

    await this.verifierPorteeSurLAuteur(ligne.requestedById);

    const [annulee] = await this.db.asUser((tx) =>
      tx
        .update(executions)
        .set({ status: 'cancelled', cancelRequestedAt: sql`now()`, finishedAt: sql`now()` })
        .where(and(eq(executions.id, id), eq(executions.status, 'queued')))
        .returning({ id: executions.id }),
    );

    if (annulee) {
      // Elle n'a jamais demarre : ni duree, ni message. Le statut et l'absence de
      // `startedAt` disent tout, et une phrase en francais posee en base serait
      // lue par quelqu'un qui travaille en anglais.
      await this.file.remove(id);
      this.relais.publierChangement(id, 'cancelled');

      return this.get(id);
    }

    // Elle tourne. L'intention est ecrite avant d'etre diffusee : un worker qui
    // redemarre la relit, un worker qui n'ecoutait pas la voit a son battement.
    await this.db.asUser((tx) =>
      tx
        .update(executions)
        .set({ cancelRequestedAt: sql`COALESCE(${executions.cancelRequestedAt}, now())` })
        .where(eq(executions.id, id)),
    );

    await this.file.publishCancel(id);
    // Aux autres lecteurs, pas au worker : l'etat ne change pas encore, mais
    // « interruption demandee » doit s'afficher partout, pas seulement chez qui
    // a clique.
    this.relais.publierChangement(id, ligne.status);

    return this.get(id);
  }

  // --- interne ---------------------------------------------------------------

  private async lire(id: string): Promise<LigneExecution> {
    const conditions: SQL[] = [eq(executions.id, id)];
    const portee = await this.restrictionDePortee();

    if (portee) conditions.push(portee);

    const [ligne] = await interroger(this.db, conditions, 1);

    // Invisible et inexistante rendent la meme reponse : distinguer les deux
    // confirmerait l'existence d'une execution d'une autre organisation.
    if (!ligne) throw new NotFoundException("Cette execution n'existe pas.");

    return ligne;
  }

  /**
   * Ce que la portee du droit retire, en plus de ce que le cloisonnement retire
   * deja.
   *
   * Le Row-Level Security borne la lecture au perimetre de travail : c'est
   * l'enveloppe exterieure, et rien n'en sort. La portee du droit resserre a
   * l'interieur -- `own` aux siennes, `entity` a l'entite active sans sa
   * descendance. `recursive` et `all` n'ajoutent rien : le perimetre est deja
   * leur plafond, et ecrire une clause qui ne filtre rien laisserait croire
   * qu'elle protege quelque chose.
   */
  private async restrictionDePortee(): Promise<SQL | undefined> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'execution', 'read');

    if (portee === 'own') return eq(executions.requestedBy, context.userId);
    if (portee === 'entity') return eq(executions.entityId, context.entityId);

    return undefined;
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
