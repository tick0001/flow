import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Charge le `.env` de la racine en repli.
 *
 * En integration continue le workflow pose les variables dans l'environnement ;
 * sur un poste elles vivent dans le `.env` de la racine, que rien ne charge
 * autrement. Sans ce repli, `pnpm test` echouerait en local et passerait a
 * distance -- l'ecart le plus penible a diagnostiquer.
 */
let dossier = import.meta.dirname;

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
