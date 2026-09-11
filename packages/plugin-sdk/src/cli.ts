#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toManifest, type Plugin } from './index.js';

/**
 * Produit le manifeste d'un plugin, a la construction.
 *
 * Usage : `flow-plugin manifeste dist/index.js [flow.plugin.json]`
 *
 * L'API lit ce fichier **avant** d'importer le module. C'est ce qui lui permet
 * de refuser un plugin incompatible, ou mal declare, sans en executer une seule
 * ligne -- la seule verification qu'elle puisse faire de l'exterieur, une fois
 * le plugin charge n'etant plus separe de l'application.
 */
const USAGE = `flow-plugin manifeste <module> [sortie]

  <module>  Le module construit qui exporte le plugin par defaut.
  [sortie]  Fichier a ecrire. Defaut : flow.plugin.json, a la racine du plugin.
`;

interface ModuleDePlugin {
  default?: unknown;
  plugin?: unknown;
}

function estPlugin(valeur: unknown): valeur is Plugin {
  if (typeof valeur !== 'object' || valeur === null) return false;

  const candidat = valeur as Partial<Plugin>;

  return (
    typeof candidat.id === 'string' &&
    typeof candidat.version === 'string' &&
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
  const charge = (await import(pathToFileURL(chemin).href)) as ModuleDePlugin;
  const plugin = charge.default ?? charge.plugin;

  if (!estPlugin(plugin)) {
    throw new Error(
      `${module} n'exporte pas de plugin. Attendu : un export par defaut construit par definirPlugin().`,
    );
  }

  const destination = sortie
    ? resolve(process.cwd(), sortie)
    : resolve(process.cwd(), 'flow.plugin.json');

  // Le chemin du module est enregistre **relativement au manifeste**, et en
  // separateurs POSIX. Un chemin absolu ne survivrait pas au deplacement du
  // dossier, et des antislash ne survivraient pas au passage sur un serveur.
  const relatif = relative(dirname(destination), chemin).split('\\').join('/');
  const manifeste = toManifest(plugin, relatif);

  await writeFile(destination, `${JSON.stringify(manifeste, null, 2)}\n`, 'utf8');

  process.stdout.write(`Manifeste ecrit : ${destination}\n`);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`${erreur instanceof Error ? erreur.message : String(erreur)}\n`);
  process.exitCode = 1;
});
