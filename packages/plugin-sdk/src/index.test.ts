import { describe, expect, it } from 'vitest';
import { SDK_MAJOR, definirPlugin, RefusPlugin, toManifest } from './index.js';

describe('definirPlugin', () => {
  it('pose la version de la surface d extension', () => {
    const plugin = definirPlugin({ id: 'essai', name: 'Essai', version: '1.0.0' });

    expect(plugin.sdk).toBe(SDK_MAJOR);
  });
});

describe('le manifeste derive', () => {
  it('deduit les hooks et les evenements des fonctions fournies', () => {
    // Deux listes -- celle du manifeste et celle du code -- auraient fini par ne
    // plus s'accorder, et l'API aurait attendu a chaque lancement un hook que
    // personne n'implemente.
    const plugin = definirPlugin({
      id: 'essai',
      name: 'Essai',
      version: '1.0.0',
      hooks: { 'execution.avant-lancement': () => undefined },
      events: { 'execution.terminee': () => undefined },
    });

    const manifeste = toManifest(plugin, 'dist/index.js');

    expect(manifeste.hooks).toEqual(['execution.avant-lancement']);
    expect(manifeste.events).toEqual(['execution.terminee']);
  });

  it('ne declare pas un hook laisse a undefined', () => {
    const plugin = definirPlugin({
      id: 'essai',
      name: 'Essai',
      version: '1.0.0',
      hooks: { 'execution.avant-lancement': undefined },
    });

    expect(toManifest(plugin, 'dist/index.js').hooks).toEqual([]);
  });

  it('ne garde des taches que leur declaration, jamais leur code', () => {
    // Le manifeste est un fichier JSON : une fonction n'y entre pas. Le verifier
    // ici evite qu'un ajout de champ ne fasse silencieusement disparaitre la
    // tache du fichier ecrit.
    const plugin = definirPlugin({
      id: 'essai',
      name: 'Essai',
      version: '1.0.0',
      tasks: [{ id: 'purge', intervalSeconds: 3600, run: () => undefined }],
    });

    expect(toManifest(plugin, 'dist/index.js').tasks).toEqual([
      { id: 'purge', intervalSeconds: 3600 },
    ]);
  });

  it('refuse un plugin que l API ne saurait pas decrire', () => {
    const plugin = definirPlugin({ id: 'Essai Majuscule', name: 'Essai', version: '1.0.0' });

    expect(() => toManifest(plugin, 'dist/index.js')).toThrow();
  });
});

describe('RefusPlugin', () => {
  it('se distingue d une panne ordinaire', () => {
    // C'est la distinction qui decide de ce qu'on montre a l'utilisateur : le
    // motif du plugin, ou « ce plugin est casse ».
    const refus = new RefusPlugin('Ce bot est gele pendant l inventaire.');

    expect(refus).toBeInstanceOf(Error);
    expect(refus.name).toBe('RefusPlugin');
    expect(refus.message).toBe('Ce bot est gele pendant l inventaire.');
  });
});
