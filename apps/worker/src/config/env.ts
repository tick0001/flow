import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Configuration du worker.
 *
 * **Un schema distinct de celui de l'API, et non un schema partage.** Les deux
 * processus ne lisent pas les memes variables : le worker n'a ni port HTTP, ni
 * secret de session, ni cle de chiffrement, et un schema commun l'obligerait a
 * refuser de demarrer faute d'un reglage dont il ne fait rien. C'est exactement
 * le genre de couplage qui fait qu'on finit par tout declarer optionnel -- et
 * qu'une variable reellement obligatoire passe alors inapercue.
 *
 * Seule la recherche du fichier `.env` est identique, et c'est douze lignes.
 */
export function appRoot(): string {
  // `import.meta.dirname` vaut `<racine>/apps/worker/{src,dist}/config` : la
  // racine du depot est a quatre niveaux au-dessus, compile ou non.
  return resolve(import.meta.dirname, '../../../..');
}

export function loadEnvFiles(): void {
  for (const candidat of [resolve(process.cwd(), '.env'), resolve(appRoot(), '.env')]) {
    try {
      process.loadEnvFile(candidat);
      return;
    } catch {
      // Fichier absent : on essaie le suivant, puis on s'en remet a
      // l'environnement -- le cas normal en conteneur.
    }
  }
}

const envBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Role proprietaire : reclamer une execution, battre le coeur. Hors politiques. */
  DATABASE_URL: z.string().min(1),
  /** Role applicatif : journaux, progression, resultat. Soumis aux politiques. */
  DATABASE_APP_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  /**
   * Dossier des bots. Le worker y **importe les modules**, contrairement a l'API
   * qui n'y lit que des manifestes.
   */
  BOTS_PATH: z.string().min(1).default('./bots'),

  /**
   * Identifiant de ce worker, tel qu'il apparait sur les executions qu'il
   * detient.
   *
   * Machine et numero de processus par defaut : suffisant pour retrouver dans
   * quel conteneur regarder, ce qui est la seule question qu'on se pose devant
   * cette colonne.
   */
  WORKER_ID: z
    .string()
    .min(1)
    .default(`${hostname()}-${String(process.pid)}`),

  /**
   * Executions simultanees sur cette machine.
   *
   * Deux par defaut, et non dix : **un run coute un navigateur**, soit quelques
   * centaines de mega-octets et un vrai budget processeur -- ce qui n'a rien a
   * voir avec une requete HTTP. C'est un reglage de machine, decide par qui
   * connait la memoire disponible, et non un reglage de l'application.
   */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),

  /**
   * Cette machine peut-elle ouvrir une fenetre de navigateur ?
   *
   * Faux par defaut : un serveur n'a pas d'affichage, et un Chromium lance en
   * mode visible y echoue au demarrage. Une execution qui demande le mode visible
   * sur une machine qui ne peut pas le servir tourne alors sans fenetre, et son
   * journal le dit -- plutot que d'echouer sur une erreur de pilote que personne
   * ne rattacherait a une case cochee dans un formulaire.
   */
  WORKER_HEADED: envBoolean.default(false),

  /**
   * Duree maximale d'une execution.
   *
   * Sans elle, un bot boucle sans fin garde un navigateur et une place de
   * concurrence pour toujours : le balayage des orphelines ne le rattrape pas,
   * puisque le worker est bien vivant et bat le coeur pour lui. C'est le seul
   * garde-fou contre un bot qui ne rend jamais la main.
   */
  WORKER_RUN_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(24 * 3600)
    .default(1800),

  /**
   * Dossier de travail ou les bots deposent ce qui doit survivre.
   *
   * Un sous-dossier par execution, verse au stockage de fichiers a la fin puis
   * retire. C'est un espace de passage, pas un archivage : ce qui compte est
   * dans le stockage.
   */
  WORKER_OUTPUT_PATH: z.string().min(1).default('./donnees/travail'),

  /**
   * Racine du stockage de fichiers.
   *
   * **L'API doit voir le meme dossier** pour servir les pieces : sur une seule
   * machine cela va de soi, sur plusieurs il faut un volume partage -- ou une
   * implementation S3, que l'interface du stockage attend sans rien changer
   * autour.
   */
  STORAGE_PATH: z.string().min(1).default('./donnees/stockage'),

  /**
   * Enregistrer une trace Playwright de chaque execution.
   *
   * La trace est de loin la piece la plus utile pour comprendre un echec : elle
   * rejoue le run action par action, avec les captures et le DOM de chaque etape.
   * Elle **n'est gardee qu'en cas d'echec** -- une trace de run reussi ne sert a
   * personne et pese des mega-octets.
   *
   * Le cout est reel et permanent : enregistrer ralentit chaque execution, y
   * compris celles qui reussiront. C'est pour cela que le reglage existe.
   */
  WORKER_TRACE: envBoolean.default(true),

  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
});

export type Env = z.infer<typeof envSchema>;

let cache: Env | undefined;

export function loadEnv(): Env {
  if (cache) return cache;

  const resultat = envSchema.safeParse(process.env);

  if (!resultat.success) {
    const details = resultat.error.issues
      .map((probleme) => `  ${probleme.path.join('.')} : ${probleme.message}`)
      .join('\n');

    throw new Error(`Configuration invalide.\n${details}\n\nVoir .env.example.`);
  }

  cache = resultat.data;

  return cache;
}

/** Vide le cache. Reserve aux tests, qui font varier l'environnement. */
export function resetEnvCache(): void {
  cache = undefined;
}

/** Chemin absolu d'un reglage de dossier, ancre sur la racine du depot si relatif. */
export function resolveFromRoot(chemin: string): string {
  return resolve(appRoot(), chemin);
}
