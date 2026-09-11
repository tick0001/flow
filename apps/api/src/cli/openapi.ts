import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { appRoot, loadEnv, loadEnvFiles } from '../config/env.js';
import { documentOpenApi } from '../openapi/generateur.js';

/**
 * Ecrit la description OpenAPI du serveur.
 *
 * Usage : `pnpm openapi [sortie]`
 *
 * Le document est **deduit des controleurs**, sans demarrer l'application : ni
 * base, ni Redis, ni dossier de bots. Une description qui exigerait une
 * installation qui tourne ne serait produite ni en integration continue, ni sur
 * le poste de qui veut ecrire un client.
 */
async function main(): Promise<void> {
  loadEnvFiles();

  const sortie = process.argv[2] ?? resolve(appRoot(), 'openapi.json');
  const document = documentOpenApi(AppModule, `${loadEnv().API_URL}`);

  await writeFile(sortie, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const routes = Object.values(document['paths'] as Record<string, object>).reduce(
    (total, chemin) => total + Object.keys(chemin).length,
    0,
  );

  process.stdout.write(`Description ecrite : ${sortie} (${String(routes)} routes)\n`);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`${erreur instanceof Error ? erreur.message : String(erreur)}\n`);
  process.exitCode = 1;
});
