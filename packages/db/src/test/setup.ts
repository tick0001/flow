import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Charge le `.env` de la racine en repli.
 *
 * Les tests d'integration exigent `DATABASE_URL` et `DATABASE_APP_URL`. En
 * integration continue, le workflow les pose dans l'environnement ; sur un poste
 * de developpement, elles vivent dans le `.env` de la racine, que rien ne charge
 * autrement. Sans ce repli, `pnpm test` echouerait en local et passerait a
 * distance -- l'ecart le plus penible a diagnostiquer.
 *
 * Les valeurs deja presentes dans l'environnement l'emportent : `process.loadEnvFile`
 * n'ecrase pas ce qui existe.
 */
let dossier = dirname(fileURLToPath(import.meta.url));

for (;;) {
  const candidat = join(dossier, '.env');

  if (existsSync(candidat)) {
    process.loadEnvFile(candidat);
    break;
  }

  const parent = dirname(dossier);

  if (parent === dossier) break;

  dossier = parent;
}
