import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SDK_MAJOR } from '@flow/bot-sdk';
import { BotRegistryService, SDK_MAJOR_SERVI } from './bot-registry.service.js';
import { resetEnvCache } from '../config/env.js';

const MANIFESTE = {
  id: 'essai.bot',
  name: 'Essai',
  description: 'Un bot de test.',
  version: '1.0.0',
  author: 'Test',
  tags: ['essai'],
  parameters: { type: 'object', properties: { cible: { type: 'string' } }, required: ['cible'] },
  sdk: SDK_MAJOR_SERVI,
};

describe('version du SDK servie', () => {
  it('concorde avec celle que le SDK declare', () => {
    // L'API ne depend pas de `@flow/bot-sdk` a l'execution -- il tire Playwright
    // dans ses types -- et recopie donc la valeur. Ce test est ce qui empeche la
    // copie de devenir une divergence : sans lui, monter la majeure du SDK
    // laisserait le serveur refuser tous les bots neufs, ou pire, accepter des
    // bots ecrits pour un contexte qui a change de sens.
    expect(SDK_MAJOR_SERVI).toBe(SDK_MAJOR);
  });
});

describe('registre des bots', () => {
  let dossier: string;
  let registre: BotRegistryService;

  const deposer = async (nom: string, manifeste: unknown, sousDist = false): Promise<void> => {
    const cible = sousDist ? join(dossier, nom, 'dist') : join(dossier, nom);

    await mkdir(cible, { recursive: true });
    await writeFile(join(cible, 'flow.bot.json'), JSON.stringify(manifeste), 'utf8');
  };

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'flow-bots-'));
    process.env['BOTS_PATH'] = dossier;
    resetEnvCache();
    registre = new BotRegistryService();
  });

  afterEach(async () => {
    delete process.env['BOTS_PATH'];
    resetEnvCache();
    await rm(dossier, { recursive: true, force: true });
  });

  it('lit un bot depose, sans rien compiler', async () => {
    // Le critere de sortie du jalon : un dossier avec son manifeste suffit.
    await deposer('un-bot', MANIFESTE);

    const bots = await registre.reload();

    expect(bots).toHaveLength(1);
    expect(bots[0]?.manifest.id).toBe('essai.bot');
    expect(bots[0]?.loaded).toBe(true);
  });

  it('accepte aussi un manifeste dans le dossier de construction', async () => {
    // Ce qui permet au depot d'heberger son bot de reference sans etape de
    // copie ; une installation reelle n'utilise que la racine du dossier.
    await deposer('construit', MANIFESTE, true);

    expect(await registre.reload()).toHaveLength(1);
  });

  it('refuse un bot d’une autre majeure de SDK, mais le garde visible', async () => {
    // Le faire disparaitre enverrait chercher dans les journaux du conteneur
    // une reponse qui tient en une ligne a l'ecran.
    await deposer('trop-recent', { ...MANIFESTE, sdk: SDK_MAJOR_SERVI + 1 });

    const bots = await registre.reload();

    expect(bots).toHaveLength(1);
    expect(bots[0]?.loaded).toBe(false);
    expect(bots[0]?.loadError).toMatch(/version/i);
  });

  it('refuse un manifeste invalide sans faire tomber le reste', async () => {
    // Un bot fautif ne doit pas empecher les autres d'apparaitre : une
    // installation ou un seul dossier casse tout le catalogue est ingerable.
    await deposer('valide', MANIFESTE);
    await deposer('casse', { id: 'PAS VALIDE', sdk: 'un' });

    const bots = await registre.reload();

    expect(bots.filter((bot) => bot.loaded)).toHaveLength(1);
    expect(bots.filter((bot) => !bot.loaded)).toHaveLength(1);
  });

  it('ignore un dossier sans manifeste', async () => {
    // Un `node_modules` egare, un dossier de sources : ce n'est pas un bot, et
    // le signaler remplirait les journaux d'avertissements sans objet.
    await mkdir(join(dossier, 'pas-un-bot'), { recursive: true });

    expect(await registre.reload()).toHaveLength(0);
  });

  it('garde le premier de deux bots au meme identifiant', async () => {
    // Celui qui gagnerait dependrait autrement de l'ordre du systeme de
    // fichiers, donc du hasard -- et changerait d'une machine a l'autre.
    await deposer('a-premier', MANIFESTE);
    await deposer('b-second', { ...MANIFESTE, name: 'Doublon' });

    const bots = await registre.reload();

    expect(bots).toHaveLength(1);
    expect(bots[0]?.manifest.name).toBe('Essai');
  });

  it('traite un dossier absent comme une installation sans bot', async () => {
    // Etat normal d'une installation neuve, pas une panne.
    process.env['BOTS_PATH'] = join(dossier, 'inexistant');
    resetEnvCache();

    expect(await registre.reload()).toHaveLength(0);
  });
});
