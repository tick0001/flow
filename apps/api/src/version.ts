/**
 * Version du produit, lue depuis le manifeste de l'API.
 *
 * `apps/api/package.json` est le seul manifeste que le processus puisse lire a
 * l'execution : `pnpm deploy` produit une arborescence dont il est la racine.
 * C'est donc lui qui fait autorite, et `/api/health` le sert pour qu'un
 * exploitant sache ce qui tourne chez lui.
 */
import { createRequire } from 'node:module';

const manifeste = createRequire(__filename)('../package.json') as { version?: string };

export const version: string = manifeste.version ?? '0.0.0';
