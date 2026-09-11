import 'reflect-metadata';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { version } from '../version.js';

/**
 * Types de parametres de route, tels que NestJS les numerote.
 *
 * Les valeurs viennent de son enumere `RouteParamtypes`, non exporte. Les
 * recopier est un pari sur sa stabilite -- elles n'ont pas bouge depuis des
 * annees, et un test verifie que chaque route decrite porte bien ce qu'on croit.
 */
const CORPS = 3;
const REQUETE = 4;

/** Verbes HTTP, dans l'ordre de l'enumere `RequestMethod` de NestJS. */
const VERBES = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head', 'search'];

interface Route {
  chemin: string;
  verbe: string;
  controleur: string;
  operation: string;
  droit: { object: string; action: string } | undefined;
  corps: z.ZodType | undefined;
  requete: z.ZodType | undefined;
  parametres: string[];
}

/** Une classe decoree, telle que `Reflect` la rend. */
type Decoree = abstract new (...args: never[]) => unknown;

/**
 * Les controleurs d'un module, et de ceux qu'il importe.
 *
 * Lecture **statique** : les decorateurs posent leurs metadonnees a l'import, et
 * rien n'est instancie. Booter l'application pour la decrire aurait demande une
 * base, un Redis et un dossier de bots -- pour produire un fichier qui ne depend
 * d'aucun des trois.
 */
export function controleursDe(module: Decoree, vus = new Set<Decoree>()): Decoree[] {
  if (vus.has(module)) return [];

  vus.add(module);

  const directs = (Reflect.getMetadata('controllers', module) ?? []) as Decoree[];
  const imports = (Reflect.getMetadata('imports', module) ?? []) as Decoree[];

  return [...directs, ...imports.flatMap((importe) => controleursDe(importe, vus))];
}

/** Les routes d'un controleur, telles que NestJS les servira. */
export function routesDe(controleur: Decoree): Route[] {
  const base = normaliser((Reflect.getMetadata('path', controleur) ?? '') as string);
  const prototype = controleur.prototype as Record<string, unknown>;
  const routes: Route[] = [];

  for (const nom of Object.getOwnPropertyNames(prototype)) {
    if (nom === 'constructor') continue;

    const methode = prototype[nom];

    if (typeof methode !== 'function') continue;

    const verbeIndex = Reflect.getMetadata('method', methode) as number | undefined;

    if (verbeIndex === undefined) continue;

    const suffixe = normaliser((Reflect.getMetadata('path', methode) ?? '') as string);
    const chemin = `/api${base}${suffixe}`;
    const args = (Reflect.getMetadata('__routeArguments__', controleur, nom) ?? {}) as Record<
      string,
      { pipes?: unknown[] }
    >;

    routes.push({
      chemin,
      verbe: VERBES[verbeIndex] ?? 'get',
      controleur: controleur.name,
      operation: nom,
      droit: Reflect.getMetadata('flow:right', methode) as Route['droit'],
      corps: schemaDe(args, CORPS),
      requete: schemaDe(args, REQUETE),
      parametres: [...chemin.matchAll(/:([A-Za-z0-9_]+)/g)].map((trouve) => trouve[1] ?? ''),
    });
  }

  return routes;
}

/**
 * Le schema Zod d'un parametre, lu sur le tuyau de validation.
 *
 * **C'est pour cela que `ZodValidationPipe` expose son schema.** La description
 * se deduit ainsi de ce que le code **verifie reellement**, plutot que d'une
 * documentation tenue en parallele -- qui aurait commence a mentir au premier
 * champ ajoute.
 */
function schemaDe(
  args: Record<string, { pipes?: unknown[] }>,
  type: number,
): z.ZodType | undefined {
  for (const [clef, valeur] of Object.entries(args)) {
    if (!clef.startsWith(`${String(type)}:`)) continue;

    for (const tuyau of valeur.pipes ?? []) {
      if (tuyau instanceof ZodValidationPipe) return tuyau.schema;
    }
  }

  return undefined;
}

function normaliser(chemin: string): string {
  if (chemin === '' || chemin === '/') return '';

  return chemin.startsWith('/') ? chemin : `/${chemin}`;
}

/**
 * Convertit un schema Zod en JSON Schema, ou rend une forme permissive.
 *
 * Tout ce que Zod exprime ne se traduit pas : un `refine` n'a pas d'equivalent.
 * Plutot que d'echouer -- ce qui priverait le document de toutes les routes pour
 * une seule -- on decrit ce qui se decrit, et l'on note le reste.
 */
function versJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  } catch {
    return {
      type: 'object',
      description: 'Forme non representable en JSON Schema ; voir le schema Zod des contrats.',
    };
  }
}

/**
 * Le document OpenAPI, deduit des controleurs.
 *
 * Il decrit **exactement** les routes qui existent, parce qu'il est produit a
 * partir d'elles. Une description ecrite a la main aurait diverge du code, et la
 * divergence se serait vue au pire moment : quand quelqu'un l'utilise pour
 * ecrire un client.
 */
export function documentOpenApi(module: Decoree, serveur: string): Record<string, unknown> {
  const routes = controleursDe(module).flatMap((controleur) => routesDe(controleur));
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes.sort((a, b) => a.chemin.localeCompare(b.chemin))) {
    // OpenAPI note les parametres `{ainsi}`, NestJS `:ainsi`.
    const chemin = route.chemin.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

    paths[chemin] ??= {};

    const parametres: Record<string, unknown>[] = route.parametres.map((nom) => ({
      name: nom,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    if (route.requete) {
      const forme = versJsonSchema(route.requete);
      const proprietes = (forme['properties'] ?? {}) as Record<string, unknown>;
      const requis = (forme['required'] ?? []) as string[];

      for (const [nom, definition] of Object.entries(proprietes)) {
        parametres.push({
          name: nom,
          in: 'query',
          required: requis.includes(nom),
          schema: definition,
        });
      }
    }

    paths[chemin][route.verbe] = {
      operationId: `${route.controleur.replace(/Controller$/, '')}_${route.operation}`,
      tags: [route.controleur.replace(/Controller$/, '')],
      summary: route.droit
        ? `Droit requis : ${route.droit.object}:${route.droit.action}`
        : 'Aucun droit particulier.',
      ...(parametres.length > 0 ? { parameters: parametres } : {}),
      ...(route.corps
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: versJsonSchema(route.corps) } },
            },
          }
        : {}),
      responses: {
        '200': { description: 'Succes.' },
        '400': { description: 'Donnees invalides.' },
        '401': { description: 'Authentification requise.' },
        '403': { description: 'Droit manquant.' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Flow&',
      version,
      description:
        "Automatisation navigateur. Cette description est **deduite des controleurs** : elle decrit exactement les routes qui existent, et les formes qu'elles valident reellement.",
      license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: serveur }],
    components: {
      securitySchemes: {
        // Deux moyens, et la distinction compte pour qui lit : le cookie sert
        // l'interface, la clef sert ce qui n'a pas de navigateur.
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'flow_session',
          description: "Cookie pose par `/api/auth/login`. Utilise par l'interface.",
        },
        cle: {
          type: 'http',
          scheme: 'bearer',
          description:
            "Clef d'API, en en-tete `Authorization`. Elle agit comme le compte qui l'a creee, avec son profil et son entite.",
        },
      },
    },
    security: [{ session: [] }, { cle: [] }],
    paths,
  };
}
