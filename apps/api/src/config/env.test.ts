import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieSecure, loadEnv, resetEnvCache } from './env.js';

const MINIMUM = {
  DATABASE_URL: 'postgres://flow:flow@localhost:5433/flow',
  DATABASE_APP_URL: 'postgres://flow_app:flow_app@localhost:5433/flow',
  REDIS_URL: 'redis://localhost:6380',
  SESSION_SECRET: 'secret-assez-long-pour-passer',
  ENCRYPTION_KEY: '0'.repeat(64),
};

describe('configuration', () => {
  let sauvegarde: NodeJS.ProcessEnv;

  beforeEach(() => {
    sauvegarde = process.env;
    // Un environnement neuf : le `.env` du poste est charge par le setup, et
    // ses valeurs masqueraient ce que chaque cas veut eprouver.
    process.env = { ...MINIMUM };
    resetEnvCache();
  });

  afterEach(() => {
    process.env = sauvegarde;
    resetEnvCache();
  });

  it('refuse de demarrer sur une configuration incomplete', () => {
    // Le point entier de la validation : une API qui demarre sans base echoue
    // plus tard, ailleurs, et pour une raison illisible.
    delete process.env['DATABASE_APP_URL'];

    expect(() => loadEnv()).toThrow(/DATABASE_APP_URL/);
  });

  it('refuse un secret de session trop court', () => {
    // Une valeur courte ne casse rien a l'execution : elle rend seulement les
    // jetons devinables, c'est-a-dire qu'elle ne se remarque jamais.
    process.env['SESSION_SECRET'] = 'court';

    expect(() => loadEnv()).toThrow(/SESSION_SECRET/);
  });

  it('refuse une clef de chiffrement qui n’est pas 32 octets hexadecimaux', () => {
    process.env['ENCRYPTION_KEY'] = 'pas-hexadecimal';

    expect(() => loadEnv()).toThrow(/ENCRYPTION_KEY/);
  });

  it('applique les ports decales par defaut', () => {
    // Decales pour cohabiter avec les autres projets de la collection.
    const env = loadEnv();

    expect(env.API_PORT).toBe(3100);
    expect(env.WEB_URL).toBe('http://localhost:5273');
  });

  it('lit « false » comme faux dans un booleen d’environnement', () => {
    // `z.coerce.boolean()` aurait rendu vrai : la chaine est non vide. Un
    // reglage desactive par ecrit et actif a l'execution ne se remarque qu'au
    // moment ou il fait des degats.
    process.env['NODE_ENV'] = 'production';
    process.env['COOKIE_SECURE'] = 'false';

    expect(cookieSecure(loadEnv())).toBe(false);
  });

  it('marque le cookie Secure en production, sans reglage explicite', () => {
    process.env['NODE_ENV'] = 'production';

    expect(cookieSecure(loadEnv())).toBe(true);
  });

  it('laisse le cookie non securise en developpement', () => {
    // Sinon le navigateur refuserait le cookie sur `http://localhost`, et la
    // connexion echouerait sans message.
    expect(cookieSecure(loadEnv())).toBe(false);
  });
});
