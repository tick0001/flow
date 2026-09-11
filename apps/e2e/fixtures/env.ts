import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Charge le `.env` de la racine.
 *
 * Playwright ne lit aucun fichier d'environnement de lui-meme, et les parcours
 * ont besoin de `DATABASE_URL` pour poser leur decor. Sans ce chargement, la
 * campagne echouerait sur la premiere ligne avec « DATABASE_URL est absent » --
 * ce qui est exact et ne dit pas quoi faire.
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
