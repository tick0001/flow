import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  BATTEMENT_MS,
  CANAL_ANNULATION,
  EXECUTION_QUEUE,
  cancelOrderSchema,
  executionJobSchema,
} from '@flow/contracts';
import { loadEnv, loadEnvFiles } from './config/env.js';
import { Depot } from './depot.js';
import { Diffusion } from './diffusion.js';
import { Executeur } from './executeur.js';
import { journalDe } from './log.js';
import { Navigateurs } from './navigateur.js';
import { dossierDesBots } from './registre.js';

const log = journalDe('Worker');

/**
 * Le worker : un processus, une file, des navigateurs.
 *
 * Pas de NestJS ici, et c'est un choix. Le worker n'a pas de requetes HTTP, pas
 * de gardes, pas de controleurs : il depile. Le conteneur d'injection ne lui
 * apporterait que le cout de son demarrage et une indirection de plus entre le
 * travail depile et le navigateur qui l'execute.
 *
 * Pas de serveur HTTP non plus -- donc pas de sonde de sante propre. Sa presence
 * se lit depuis l'API, qui compte les workers vivants declares a la file : un
 * worker en vie est un worker que la file connait, ce qui est precisement ce
 * qu'on veut savoir. Un port ouvert aurait dit qu'un processus tourne, pas qu'il
 * travaille.
 */
async function bootstrap(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();

  log.log(`Demarrage de ${env.WORKER_ID}.`);
  log.log(`Bots lus dans ${dossierDesBots()}, ${String(env.WORKER_CONCURRENCY)} en parallele.`);

  const depot = new Depot(env.WORKER_ID);
  const navigateurs = new Navigateurs();
  const diffusion = new Diffusion();

  await diffusion.demarrer();

  const executeur = new Executeur(depot, navigateurs, diffusion);

  // `maxRetriesPerRequest: null` est exige par BullMQ pour la connexion d'un
  // worker : il attend un travail par une commande bloquante, que ioredis
  // compterait autrement comme une requete qui ne repond pas et abandonnerait au
  // bout de vingt tentatives -- le worker cesserait alors de depiler sans qu'une
  // seule erreur ne le dise.
  const connexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const abonne = new Redis(env.REDIS_URL);

  for (const [nom, client] of [
    ['file', connexion],
    ['annulations', abonne],
  ] as const) {
    client.on('error', (erreur: Error) => {
      log.warn(`Redis (${nom}) : ${erreur.message}`);
    });
  }

  const worker = new Worker(
    EXECUTION_QUEUE,
    async (travail) => {
      // Le contenu du travail est revalide : il vient de Redis, ou une version
      // precedente du worker a pu deposer une autre forme, et un travail
      // malforme doit etre refuse ici plutot que casser plus loin.
      await executeur.executer(executionJobSchema.parse(travail.data));
    },
    {
      connection: connexion,
      concurrency: env.WORKER_CONCURRENCY,
      // Le verrou tient plus longtemps qu'un battement de coeur. BullMQ declare
      // « bloque » un travail dont le verrou expire et le redistribue : avec la
      // valeur par defaut de trente secondes, toute execution plus longue que
      // cela serait redistribuee en boucle. La reclamation la refuserait --
      // l'execution est deja `running` -- mais la file s'agiterait pour rien.
      lockDuration: BATTEMENT_MS * 4,
    },
  );

  worker.on('failed', (travail, erreur) => {
    // Un travail ne devrait jamais echouer : l'executeur transforme chaque echec
    // en denouement. Si cela arrive quand meme, c'est un defaut du worker
    // lui-meme, et il faut le voir.
    log.error(`Travail ${travail?.id ?? '?'} en echec : ${erreur.message}`);
  });

  /**
   * Le chemin rapide de l'annulation.
   *
   * Tous les workers ecoutent le meme canal ; celui qui detient l'execution visee
   * agit, les autres ignorent. L'intention est deja en base quand ce message
   * arrive : ceci ne fait que gagner le temps d'un battement de coeur.
   */
  await abonne.subscribe(CANAL_ANNULATION);

  abonne.on('message', (_canal: string, contenu: string) => {
    const lecture = cancelOrderSchema.safeParse(JSON.parse(contenu));

    if (!lecture.success) {
      log.warn(`Ordre d'annulation illisible : ${contenu}`);

      return;
    }

    executeur.interrompre(lecture.data.executionId, 'annulation');
  });

  /**
   * Le chemin fiable de l'annulation, et la preuve de vie.
   *
   * Le meme aller-retour fait les deux : il pose le battement sur les executions
   * detenues et rapporte celles dont on demande l'interruption. Un worker qui
   * n'ecoutait pas au bon moment -- redemarre, reconnecte -- voit donc la demande
   * ici, un battement plus tard au pire.
   */
  const battement = setInterval(() => {
    void (async () => {
      try {
        for (const id of await depot.battre(executeur.detenues())) {
          executeur.interrompre(id, 'annulation');
        }
      } catch (erreur: unknown) {
        // Une base momentanement absente ne doit pas arreter le worker : le
        // battement suivant reprendra. Le risque est qu'une execution soit
        // declaree orpheline si l'absence dure plus de quatre battements, ce qui
        // est le comportement voulu -- on ne sait plus dire si elle vit.
        log.warn(`Battement de coeur manque : ${String(erreur)}`);
      }
    })();
  }, BATTEMENT_MS);

  let arretEnCours = false;

  const arreter = (signal: string): void => {
    if (arretEnCours) {
      // Deuxieme signal : on n'attend plus. Quelqu'un insiste, et une execution
      // en cours ne doit pas empecher d'eteindre.
      log.warn('Second signal : arret immediat.');
      process.exit(1);
    }

    arretEnCours = true;
    log.log(`${signal} recu : arret.`);

    void (async () => {
      try {
        clearInterval(battement);
        // Fermer le worker d'abord : il cesse de depiler, si bien qu'on ne
        // reclame pas une execution de plus pendant qu'on abandonne les autres.
        await worker.close();
        await executeur.abandonnerTout();
        await navigateurs.fermerTout();
        await diffusion.fermer();
        await abonne.unsubscribe(CANAL_ANNULATION);
        abonne.disconnect();
        await depot.fermer();
        log.log('Arret propre.');
        process.exit(0);
      } catch (erreur: unknown) {
        log.error(`Arret en erreur : ${String(erreur)}`);
        process.exit(1);
      }
    })();
  };

  process.on('SIGINT', () => {
    arreter('SIGINT');
  });
  process.on('SIGTERM', () => {
    arreter('SIGTERM');
  });

  log.log('En attente de travaux.');
}

bootstrap().catch((erreur: unknown) => {
  log.error(`Demarrage impossible : ${String(erreur)}`);
  process.exit(1);
});
