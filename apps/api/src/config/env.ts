import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Charge les fichiers `.env` avant toute lecture de configuration.
 *
 * Appele explicitement plutot que laisse a l'environnement du shell : `node
 * dist/main.js` doit se comporter comme `pnpm dev`, sur un poste comme dans un
 * conteneur. Les variables deja definies dans l'environnement ont la priorite,
 * ce que garantit `process.loadEnvFile`.
 *
 * `__dirname` vaut `<racine>/apps/api/{src,dist}/config` : la racine du depot est
 * a quatre niveaux au-dessus, que le code soit compile ou non.
 */
export function appRoot(): string {
  return resolve(__dirname, '../../../..');
}

export function loadEnvFiles(): void {
  const candidats = [resolve(process.cwd(), '.env'), resolve(appRoot(), '.env')];

  for (const candidat of candidats) {
    try {
      process.loadEnvFile(candidat);
      return;
    } catch {
      // Fichier absent : on essaie le suivant, puis on s'en remet a
      // l'environnement -- ce qui est le cas normal en conteneur.
    }
  }
}

/**
 * Booleen venant d'une variable d'environnement.
 *
 * `z.coerce.boolean()` ne convient pas : il applique la veracite JavaScript, ou
 * la chaine « false » vaut vrai. Un reglage desactive par ecrit et actif a
 * l'execution ne se remarque qu'au moment ou il fait des degats.
 */
const envBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3100),
  API_URL: z.url().default('http://localhost:3100'),
  WEB_URL: z.url().default('http://localhost:5273'),

  /** Role proprietaire : migrations et amorcage. Exempte de Row-Level Security. */
  DATABASE_URL: z.string().min(1),
  /** Role applicatif : tout le trafic normal, soumis au Row-Level Security. */
  DATABASE_APP_URL: z.string().min(1),
  /**
   * Connexions simultanees du pool applicatif : le plafond de debit de
   * l'installation. L'augmenter n'a de sens que si `max_connections` de
   * PostgreSQL suit, sinon le gain se transforme en refus de connexion.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

  REDIS_URL: z.string().min(1),

  /**
   * Secret de session.
   *
   * Seize caracteres au minimum, et le refus est franc : une valeur trop courte
   * ne casse rien a l'execution, elle rend seulement les jetons devinables --
   * c'est-a-dire qu'elle ne se remarque jamais.
   */
  SESSION_SECRET: z.string().min(16),
  /** 32 octets en hexadecimal : chiffrement des secrets stockes en base. */
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, '64 caracteres hexadecimaux attendus'),

  /**
   * Dossier scanne pour les bots deposes.
   *
   * Relatif a la racine du depot, ou absolu. L'API n'y lit que des manifestes
   * JSON ; c'est le worker qui importe les modules.
   */
  BOTS_PATH: z.string().min(1).default('./bots'),

  DEFAULT_LOCALE: z.enum(['fr', 'en']).default('fr'),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),

  /**
   * Cookie de session marque `Secure`.
   *
   * Actif par defaut hors developpement. Le desactiver sur une installation
   * servie en HTTPS reviendrait a laisser le cookie voyager en clair si une
   * seule requete partait en HTTP.
   */
  COOKIE_SECURE: envBoolean.optional(),
});

export type Env = z.infer<typeof envSchema>;

let cache: Env | undefined;

/**
 * Configuration d'execution, validee au demarrage.
 *
 * Le processus refuse de demarrer si une variable est absente ou mal formee :
 * une API qui demarre avec une configuration incomplete echoue plus tard,
 * ailleurs, et pour une raison illisible.
 */
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

/** Le cookie doit-il etre marque `Secure` ? */
export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
}
