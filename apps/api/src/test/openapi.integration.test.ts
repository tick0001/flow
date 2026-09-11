import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { documentOpenApi } from '../openapi/generateur.js';

/** Une couche du routeur Express, telle qu'on doit la parcourir. */
interface Couche {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Couche[] };
}

/**
 * Les routes que le serveur sert reellement.
 *
 * Lues sur la pile du routeur Express, et non sur les metadonnees : c'est tout
 * l'interet du test. Comparer les metadonnees a une description deduite des
 * memes metadonnees ne prouverait rien -- les deux cotes diraient la meme chose
 * par construction, y compris quand ils ont tort.
 */
function routesServies(app: INestApplication): Set<string> {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: Couche[] };
    _router?: { stack: Couche[] };
  };
  const routeur = instance.router ?? instance._router;
  const trouvees = new Set<string>();

  const parcourir = (pile: Couche[] | undefined): void => {
    for (const couche of pile ?? []) {
      if (couche.route) {
        for (const verbe of Object.keys(couche.route.methods)) {
          trouvees.add(`${verbe.toUpperCase()} ${couche.route.path}`);
        }
      } else if (couche.name === 'router') {
        parcourir(couche.handle?.stack);
      }
    }
  };

  parcourir(routeur?.stack);

  // Le middleware de contexte s'enregistre sur `*path`, pour toutes les methodes.
  // Ce n'est pas une route : il n'a ni controleur, ni droit, ni reponse.
  trouvees.delete('_ALL *path');

  return trouvees;
}

/**
 * Le critere de sortie du jalon J6 : la description dit **exactement** ce qui
 * existe.
 *
 * Une description ecrite a la main aurait diverge du code, et la divergence se
 * serait vue au pire moment : quand quelqu'un s'en sert pour ecrire un client.
 */
describe('description OpenAPI', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  }, 30_000);

  it('decrit exactement les routes servies', () => {
    const document = documentOpenApi(AppModule, 'http://localhost');
    const paths = document['paths'] as Record<string, Record<string, unknown>>;
    const decrites = new Set<string>();

    for (const [chemin, operations] of Object.entries(paths)) {
      for (const verbe of Object.keys(operations)) {
        // OpenAPI note `{id}`, Express `:id`.
        decrites.add(`${verbe.toUpperCase()} ${chemin.replace(/\{([^}]+)\}/g, ':$1')}`);
      }
    }

    const servies = routesServies(app);

    expect([...servies].filter((route) => !decrites.has(route)).sort()).toEqual([]);
    expect([...decrites].filter((route) => !servies.has(route)).sort()).toEqual([]);
    // Un document vide passerait les deux verifications ci-dessus.
    expect(servies.size).toBeGreaterThan(30);
  });

  it('porte le droit exige de chaque route protegee', () => {
    // La description sert a ecrire un client : savoir qu'une route demande
    // `schedule:create` evite de decouvrir le refus en production.
    const paths = documentOpenApi(AppModule, 'http://localhost')['paths'] as Record<
      string,
      Record<string, { summary?: string }>
    >;

    expect(paths['/api/schedules']?.['post']?.summary).toContain('schedule:create');
    expect(paths['/api/apikeys']?.['get']?.summary).toContain('apikey:read');
    expect(paths['/api/executions/{id}/cancel']?.['post']?.summary).toContain('execution:cancel');
  });

  it('decrit les corps de requete depuis les schemas que le serveur valide', () => {
    // La forme vient du tuyau de validation, pas d'une annotation posee a cote :
    // une documentation tenue en parallele aurait menti au premier champ ajoute.
    const paths = documentOpenApi(AppModule, 'http://localhost')['paths'] as Record<
      string,
      Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>
    >;

    const corps = paths['/api/schedules']?.['post']?.requestBody?.content['application/json']
      ?.schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;

    expect(Object.keys(corps?.properties ?? {})).toEqual(
      expect.arrayContaining(['name', 'botId', 'cron', 'timezone']),
    );
    expect(corps?.required).toEqual(expect.arrayContaining(['name', 'botId', 'cron', 'timezone']));
  });
});
