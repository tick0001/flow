import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PluginRegistryService as TypeDuRegistre } from './registre.service.js';

/**
 * Le dossier des plugins est designe par l'environnement, et la configuration
 * est mise en cache a sa premiere lecture. Il faut donc le poser **avant** que
 * quoi que ce soit ne la lise -- d'ou ce fichier de test dedie, le reglage pose
 * des le chargement du module, et l'import du service differe au premier test.
 */
const dossier = mkdtempSync(join(tmpdir(), 'flow-plugins-'));

process.env['PLUGINS_PATH'] = dossier;

/** Repris du service, et compare a la sienne des le premier test. */
const NOM_MANIFESTE = 'flow.plugin.json';

/** Le fichier que les modules pieges ecrivent s'ils sont importes. */
const TEMOIN = join(dossier, 'importe.txt');

async function poser(nom: string, manifeste: unknown): Promise<void> {
  const racine = join(dossier, nom);

  await mkdir(join(racine, 'dist'), { recursive: true });

  // Un module qui **laisse une trace s'il est importe**. C'est ce qui permet
  // d'affirmer, et pas seulement d'esperer, qu'un plugin refuse n'a pas tourne.
  await writeFile(
    join(racine, 'dist', 'index.js'),
    `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(TEMOIN)}, '${nom}\\n');\nexport default {};\n`,
    'utf8',
  );

  if (manifeste !== null) {
    await writeFile(
      join(racine, NOM_MANIFESTE),
      typeof manifeste === 'string' ? manifeste : JSON.stringify(manifeste),
      'utf8',
    );
  }
}

const valide = {
  id: 'bon-plugin',
  name: 'Bon',
  version: '1.0.0',
  sdk: 1,
  module: 'dist/index.js',
};

describe('La decouverte des plugins', () => {
  let registre: TypeDuRegistre;
  let servie: number;
  let declaree: number;

  beforeAll(async () => {
    const module = await import('./registre.service.js');
    const sdk = await import('@flow/plugin-sdk');

    servie = module.SDK_MAJOR_SERVI;
    declaree = sdk.SDK_MAJOR;

    expect(module.NOM_MANIFESTE).toBe(NOM_MANIFESTE);

    await poser('bon-plugin', valide);
    await poser('majeure-inconnue', { ...valide, id: 'majeure-inconnue', sdk: 99 });
    await poser('manifeste-casse', '{ ceci ne ferme pas');
    await poser('champ-manquant', { ...valide, id: 'champ-manquant', version: 'pas-semver' });
    await poser('sans-manifeste', null);

    registre = new module.PluginRegistryService();
    await registre.relire();
  });

  afterAll(async () => {
    await rm(dossier, { recursive: true, force: true });
  });

  it('sert la majeure que le SDK declare', () => {
    // L'API reprend la valeur plutot que de l'importer, pour ne pas dependre du
    // paquet au chargement. Deux constantes qui doivent rester egales : sans ce
    // test, elles divergeraient un jour et tous les plugins seraient refuses.
    expect(servie).toBe(declaree);
  });

  it('accepte un plugin bien forme', () => {
    const plugin = registre.get('bon-plugin');

    expect(plugin?.reason).toBeNull();
    expect(plugin?.manifest?.name).toBe('Bon');
  });

  it('refuse une majeure que cette installation ne sert pas', () => {
    // Un plugin ecrit contre une autre majeure serait sinon importe, puis
    // appele avec des charges dont les champs ont change de sens.
    const plugin = registre.get('majeure-inconnue');

    expect(plugin?.manifest).toBeNull();
    expect(plugin?.reason).toMatch(/surface d'extension 99/);
  });

  it('refuse un manifeste illisible, et le dit', () => {
    const plugin = registre.get('manifeste-casse');

    expect(plugin?.manifest).toBeNull();
    expect(plugin?.reason).toMatch(/illisible/);
  });

  it('nomme le champ fautif d un manifeste invalide', () => {
    // « Manifeste invalide » tout court envoie comparer deux fichiers ligne a
    // ligne ; le champ et la contrainte tiennent en une phrase.
    const plugin = registre.get('champ-manquant');

    expect(plugin?.manifest).toBeNull();
    expect(plugin?.reason).toMatch(/version/);
  });

  it('reste visible quand le manifeste manque', () => {
    // Un plugin qui disparait sans explication envoie chercher dans les
    // journaux du conteneur, alors que la reponse tient en une ligne a l'ecran.
    const plugin = registre.get('sans-manifeste');

    expect(plugin?.reason).toMatch(/flow-plugin manifeste/);
  });

  it("n'importe le module d'aucun plugin, pas meme celui qu'il accepte", async () => {
    // C'est la seule protection reelle du dispositif : la decouverte lit des
    // fichiers JSON. L'import n'a lieu qu'a l'installation, et seulement pour
    // un plugin installe et actif.
    const trace = await readFile(TEMOIN, 'utf8').catch(() => '');

    expect(trace).toBe('');
  });
});
