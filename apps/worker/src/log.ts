import { loadEnv } from './config/env.js';

/**
 * Journalisation du processus, a ne pas confondre avec le journal d'une
 * execution.
 *
 * Celui-ci raconte la vie du worker -- demarrage, reclamation, arret -- et va sur
 * la sortie standard, la ou un exploitant lit les journaux du conteneur. Celui
 * d'une execution va en base et appartient a l'execution.
 *
 * Ecrit a la main plutot qu'importe : le worker n'est pas une application NestJS,
 * et tirer `@nestjs/common` pour un `console.log` prefixe amenerait tout le
 * conteneur d'injection avec lui.
 */
const NIVEAUX = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
type Niveau = (typeof NIVEAUX)[number];

let seuil: number | undefined;

function actif(niveau: Niveau): boolean {
  // Resolu au premier appel et non a l'import : la configuration n'est validee
  // qu'apres le chargement des fichiers `.env`, dans `main`.
  seuil ??= NIVEAUX.indexOf(loadEnv().LOG_LEVEL);

  return NIVEAUX.indexOf(niveau) <= seuil;
}

function ecrire(niveau: Niveau, portee: string, message: string): void {
  if (!actif(niveau)) return;

  const ligne = `${new Date().toISOString()} ${niveau.toUpperCase().padEnd(7)} [${portee}] ${message}\n`;

  if (niveau === 'error' || niveau === 'warn') {
    process.stderr.write(ligne);
  } else {
    process.stdout.write(ligne);
  }
}

export interface Log {
  error: (message: string) => void;
  warn: (message: string) => void;
  log: (message: string) => void;
  debug: (message: string) => void;
}

export function journalDe(portee: string): Log {
  return {
    error: (message) => {
      ecrire('error', portee, message);
    },
    warn: (message) => {
      ecrire('warn', portee, message);
    },
    log: (message) => {
      ecrire('log', portee, message);
    },
    debug: (message) => {
      ecrire('debug', portee, message);
    },
  };
}

/** Remet le seuil a zero. Reserve aux tests, qui font varier l'environnement. */
export function resetLogSeuil(): void {
  seuil = undefined;
}
