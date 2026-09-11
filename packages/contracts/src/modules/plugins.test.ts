import { describe, expect, it } from 'vitest';
import { pluginManifestSchema, schemaDuPlugin } from './plugins.js';

/** Un manifeste minimal valide, que chaque test deforme a sa facon. */
const minimal = {
  id: 'exemple-carnet',
  name: 'Carnet',
  version: '1.0.0',
  sdk: 1,
  module: 'dist/index.js',
};

describe('le nom de schema d un plugin', () => {
  it('remplace ce que PostgreSQL n accepte pas dans un identifiant nu', () => {
    expect(schemaDuPlugin('exemple-carnet')).toBe('plugin_exemple_carnet');
    expect(schemaDuPlugin('acme.suivi-des-lots')).toBe('plugin_acme_suivi_des_lots');
  });

  it('tient dans les soixante-trois caracteres de PostgreSQL', () => {
    // L'identifiant est borne a quarante-huit, plus « plugin_ » : cinquante-cinq
    // au pire. Au-dela, PostgreSQL tronque en silence -- et deux plugins aux
    // noms longs et voisins partageraient alors le meme schema.
    const long = 'a'.repeat(48);

    expect(schemaDuPlugin(long).length).toBeLessThanOrEqual(63);
  });
});

describe('le manifeste d un plugin', () => {
  it('accepte un plugin qui ne fait rien, et lui donne des listes vides', () => {
    const manifeste = pluginManifestSchema.parse(minimal);

    expect(manifeste.rights).toEqual([]);
    expect(manifeste.hooks).toEqual([]);
    expect(manifeste.surfaces).toEqual([]);
    expect(manifeste.schema).toBe(false);
  });

  it('refuse un identifiant que PostgreSQL ne saurait pas porter', () => {
    expect(() => pluginManifestSchema.parse({ ...minimal, id: 'Carnet' })).toThrow();
    expect(() => pluginManifestSchema.parse({ ...minimal, id: 'mon carnet' })).toThrow();
    expect(() => pluginManifestSchema.parse({ ...minimal, id: 'a'.repeat(49) })).toThrow();
  });

  it('refuse un emplacement d interface inconnu', () => {
    // Un emplacement est un contrat. En inventer un ne produirait rien a
    // l'ecran, et rien ne dirait pourquoi.
    expect(() =>
      pluginManifestSchema.parse({
        ...minimal,
        surfaces: [{ slot: 'execution.inventee', entry: 'interface.js' }],
      }),
    ).toThrow();
  });

  it('refuse une tache de fond plus frequente que la minute', () => {
    // Une tache de plugin partage le processus de l'API.
    expect(() =>
      pluginManifestSchema.parse({ ...minimal, tasks: [{ id: 'purge', intervalSeconds: 5 }] }),
    ).toThrow();
  });

  it('exige un libelle sur un droit declare', () => {
    // Le plugin ne peut pas ajouter de clef aux dictionnaires du coeur : sans
    // libelle, la matrice des droits afficherait une case anonyme.
    expect(() =>
      pluginManifestSchema.parse({
        ...minimal,
        rights: [{ object: 'note', action: 'read', scopes: ['entity'] }],
      }),
    ).toThrow();

    expect(() =>
      pluginManifestSchema.parse({
        ...minimal,
        rights: [
          { object: 'note', action: 'read', scopes: ['entity'], label: { fr: 'Voir', en: 'View' } },
        ],
      }),
    ).not.toThrow();
  });
});
