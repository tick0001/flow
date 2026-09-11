import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { BATTEMENT_MS, BATTEMENT_PERDU_MS } from '@flow/contracts';
import { sql } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { ExecutionPurgeService } from './purge.service.js';
import { ExecutionRelayService } from './relais.service.js';

/**
 * Nombre d'executions en attente examinees par passe.
 *
 * Une borne, parce que la reconciliation interroge la file une fois par ligne :
 * apres un vidage de Redis il peut y en avoir des milliers, et les traiter d'un
 * bloc tiendrait la connexion Redis pendant tout ce temps. Les passes suivantes
 * prennent la suite -- c'est plus lent, et cela n'empeche pas l'installation de
 * servir pendant ce temps.
 */
const PAR_PASSE = 100;

/**
 * Delai de grace avant de considerer qu'une execution en attente n'a pas de
 * travail.
 *
 * Une execution vient d'etre inseree et n'est pas encore en file : c'est l'etat
 * normal pendant quelques millisecondes, puisque la ligne est ecrite avant le
 * travail. Sans ce delai, le balayage courrait contre le lancement et remettrait
 * en file ce qui y allait deja -- sans dommage, l'operation etant idempotente,
 * mais en remplissant les journaux d'un faux probleme.
 */
const GRACE_MS = 10_000;

/**
 * Une passe de purge toutes les tant de passes d'entretien.
 *
 * L'entretien tourne toutes les quinze secondes parce qu'une execution orpheline
 * doit se voir vite. La purge, elle, porte sur des jours : la lancer au meme
 * rythme ferait quatre requetes par minute pour ne trouver, presque toujours,
 * rien a faire. Une fois par heure suffit, et deborde largement.
 */
const PURGE_TOUS_LES = 240;

/**
 * L'entretien des executions : ce qui rattrape ce qui s'est mal passe ailleurs.
 *
 * Deux besognes, symetriques et distinctes.
 *
 * **Les orphelines.** Un worker tue ne vient pas dire qu'il est parti. Son
 * execution resterait `running` pour toujours, et personne ne saurait s'il faut
 * l'attendre. Passe quatre battements de coeur manques, elle est declaree
 * `abandoned` -- jamais `cancelled` : quelqu'un a interrompu la seconde, personne
 * n'a demande la premiere, et les confondre effacerait la seule trace d'une panne
 * d'infrastructure.
 *
 * **La reconciliation.** La base porte la verite, la file n'en est qu'un reflet.
 * Une execution `queued` sans travail dans la file -- Redis vide, panne pendant
 * le lancement, travail supprime a la main -- y retourne. C'est ce qui rend un
 * vidage de Redis reparable, alors qu'il aurait autrement fallu relancer chaque
 * execution a la main sans savoir lesquelles.
 *
 * **Dans l'API et non dans le worker**, alors que le worker est plus proche du
 * sujet : une installation sans worker vivant est exactement le moment ou tout
 * est orphelin, et c'est aussi le moment ou personne ne balaierait.
 */
@Injectable()
export class ExecutionMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionMaintenanceService.name);
  private minuteur: NodeJS.Timeout | undefined;
  private enCours = false;
  private passes = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly file: QueueService,
    private readonly relais: ExecutionRelayService,
    private readonly purge: ExecutionPurgeService,
  ) {}

  onApplicationBootstrap(): void {
    // Une passe immediate : apres un arret brutal, il y a precisement des
    // orphelines a ramasser, et attendre le premier intervalle les laisserait
    // affichees « en cours » a qui ouvre l'application pour comprendre.
    void this.passe();

    this.minuteur = setInterval(() => {
      void this.passe();
    }, BATTEMENT_MS);

    // Sans `unref`, le minuteur suffit a maintenir la boucle d'evenements en vie
    // et le processus refuse de s'arreter.
    this.minuteur.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Une passe d'entretien. Publique pour que les tests la declenchent. */
  async passe(): Promise<{ abandonnees: number; remisesEnFile: number }> {
    // Une passe a la fois. Une base lente ferait autrement se chevaucher deux
    // passes, qui se disputeraient les memes lignes.
    if (this.enCours) return { abandonnees: 0, remisesEnFile: 0 };

    this.enCours = true;

    try {
      const abandonnees = await this.abandonnerLesOrphelines();
      const remisesEnFile = await this.reconcilierLaFile();

      // La premiere passe purge aussi : un demarrage apres une longue coupure
      // est exactement le moment ou il y a du retard a rattraper.
      if (this.passes % PURGE_TOUS_LES === 0) await this.purge.passe();

      this.passes += 1;

      if (abandonnees > 0 || remisesEnFile > 0) {
        this.logger.warn(
          `Entretien : ${String(abandonnees)} execution(s) abandonnee(s), ${String(remisesEnFile)} remise(s) en file.`,
        );
      }

      return { abandonnees, remisesEnFile };
    } catch (erreur: unknown) {
      // Une passe qui echoue ne doit pas arreter les suivantes : la cause est le
      // plus souvent une base ou une file momentanement absente, ce que la passe
      // d'apres retrouvera.
      this.logger.error(`Entretien interrompu : ${String(erreur)}`);

      return { abandonnees: 0, remisesEnFile: 0 };
    } finally {
      this.enCours = false;
    }
  }

  /**
   * Termine les executions dont plus aucun worker ne bat le coeur.
   *
   * Par le role proprietaire : l'entretien n'a pas de requete, donc pas de
   * perimetre. Lui en donner un -- celui de qui ? -- laisserait orphelines les
   * executions de toutes les autres branches, c'est-a-dire presque toutes.
   *
   * La duree est calculee et non laissee nulle : le temps a bien ete consomme, et
   * une colonne vide ferait croire a une execution instantanee dans les
   * statistiques du jalon J7.
   */
  private async abandonnerLesOrphelines(): Promise<number> {
    const lignes = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: string }>(sql`
        UPDATE executions
           SET status = 'abandoned',
               finished_at = now(),
               duration_ms = GREATEST(
                 0,
                 (EXTRACT(EPOCH FROM (now() - COALESCE(started_at, created_at))) * 1000)::integer
               )
         WHERE status = 'running'
           AND COALESCE(heartbeat_at, started_at, created_at)
               < now() - ${`${String(BATTEMENT_PERDU_MS)} milliseconds`}::interval
        RETURNING id
      `);

      return resultat.rows;
    });

    for (const ligne of lignes) {
      // Le travail de la file n'a plus d'objet : le worker qui le detenait n'est
      // plus la pour le terminer, et le laisser ferait compter une execution
      // active qui n'existe pas.
      await this.file.remove(ligne.id);

      // Et on le dit a ceux qui regardent. C'est le seul changement d'etat que
      // l'API decide seule : le worker qui aurait du le publier est justement
      // celui qui n'est plus la. Sans cette ligne, un ecran ouvert afficherait
      // « en cours » pour toujours sur une execution que la base dit abandonnee.
      this.relais.publierChangement(ligne.id, 'abandoned');
    }

    return lignes.length;
  }

  /** Remet en file les executions en attente dont le travail a disparu. */
  private async reconcilierLaFile(): Promise<number> {
    const attendues = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: string; botId: string }>(sql`
        SELECT id, bot_id AS "botId"
          FROM executions
         WHERE status = 'queued'
           AND created_at < now() - ${`${String(GRACE_MS)} milliseconds`}::interval
         ORDER BY created_at
         LIMIT ${PAR_PASSE}
      `);

      return resultat.rows;
    });

    let remises = 0;

    for (const execution of attendues) {
      if (await this.file.hasJob(execution.id)) continue;

      await this.file.enqueue({ executionId: execution.id, botId: execution.botId });
      remises += 1;
    }

    return remises;
  }
}
