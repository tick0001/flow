#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toManifest, type Bot } from './index.js';

/**
 * Produit le manifeste d'un bot, a la construction.
 *
 * Usage : `flow-bot manifeste dist/index.js [flow.bot.json]`
 *
 * Cet outil tourne sur la machine de l'auteur, dans son script de construction.
 * Le fichier qu'il ecrit est ce que l'API lira -- elle n'importe jamais le
 * module. Deposer un bot revient a executer son auteur ; autant que cela se
 * passe dans le worker, pas dans le processus qui detient les identifiants de la
 * base.
 */
const USAGE = `flow-bot manifeste <module> [sortie]

  <module>  Le module construit qui exporte le bot par defaut.
  [sortie]  Fichier a ecrire. Defaut : flow.bot.json, a cote du module.
`;

interface ModuleDeBot {
  default?: unknown;
  bot?: unknown;
}

function estBot(valeur: unknown): valeur is Bot {
  if (typeof valeur !== 'object' || valeur === null) return false;

  const candidat = valeur as Partial<Bot>;

  return (
    typeof candidat.id === 'string' &&
    typeof candidat.run === 'function' &&
    typeof candidat.sdk === 'number'
  );
}

async function main(): Promise<void> {
  const [commande, module, sortie] = process.argv.slice(2);

  if (commande !== 'manifeste' || !module) {
    process.stdout.write(USAGE);
    process.exitCode = 1;

    return;
  }

  const chemin = resolve(process.cwd(), module);
  const charge = (await import(pathToFileURL(chemin).href)) as ModuleDeBot;
  // `default` d'abord, `bot` en repli : un module CommonJS transpile expose
  // parfois l'un, parfois l'autre, et refuser le second obligerait l'auteur a
  // deviner quelle forme son outil de construction a produite.
  const bot = charge.default ?? charge.bot;

  if (!estBot(bot)) {
    throw new Error(
      `${module} n'exporte pas de bot. Attendu : un export par defaut construit par defineBot().`,
    );
  }

  const manifeste = toManifest(bot);
  const destination = sortie
    ? resolve(process.cwd(), sortie)
    : resolve(dirname(chemin), 'flow.bot.json');

  await writeFile(destination, `${JSON.stringify(manifeste, null, 2)}\n`, 'utf8');

  process.stdout.write(`Manifeste ecrit : ${destination}\n`);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`${erreur instanceof Error ? erreur.message : String(erreur)}\n`);
  process.exitCode = 1;
});
