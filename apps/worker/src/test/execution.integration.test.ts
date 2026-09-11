import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@flow/db';
import { loadEnv } from '../config/env.js';
import { Depot } from '../depot.js';
import { Executeur } from '../executeur.js';
import { Navigateurs } from '../navigateur.js';
import { createFixture, SCHEMA_URL, type Fixture } from './fixtures.js';

/**
 * Le cycle de vie d'une execution, contre une vraie base et un vrai navigateur.
 *
 * L'executeur est monte a la main, sans BullMQ : ce qu'on veut eprouver est le
 * cycle de vie -- reclamer, executer, interrompre, denouer -- et non la
 * distribution des travaux, qui est le travail d'une bibliotheque eprouvee. Passer
 * par la file ajouterait une source d'attente et de non-determinisme a chaque
 * test, pour ne rien verifier de plus.
 *
 * Les bots sont ecrits sur disque par la fixture et importes pour de vrai, avec
 * le vrai SDK et le vrai Zod. Un bot simule aurait laisse inexplore ce qui casse
 * en pratique : la resolution du module, la forme de l'export, la validation des
 * parametres.
 */

/** Un bot qui reussit : il journalise, il progresse, et il rend un resultat. */
const BOT_REUSSI = `
import { defineBot, z } from '@flow/bot-sdk';

export default defineBot({
  id: 'essai.reussi',
  name: 'reussi',
  version: '1.0.0',
  parameters: z.object({ url: z.url() }),
  async run({ params, page, log, progress }) {
    progress('Ouverture', 10);
    log('info', 'Navigation vers ' + params.url);
    await page.goto(params.url);
    progress('Termine', 100);

    return { message: 'Titre : ' + (await page.title()), output: { vu: true } };
  },
});
`;

/**
 * Un bot qui attend un element qui n'arrivera jamais.
 *
 * C'est le cas qui compte pour l'interruption : il est suspendu **dans
 * Playwright**, qui n'ecoute aucun `AbortSignal`. Un bot qui consulterait
 * poliment `signal` entre deux etapes ne prouverait rien -- c'est la fermeture du
 * contexte navigateur qui doit l'arreter.
 */
const BOT_SUSPENDU = `
import { defineBot, z } from '@flow/bot-sdk';

export default defineBot({
  id: 'essai.suspendu',
  name: 'suspendu',
  version: '1.0.0',
  parameters: z.object({}),
  async run({ page, log }) {
    await page.goto('data:text/html,<p>rien</p>');
    log('info', 'En attente de ce qui ne viendra pas.');
    await page.waitForSelector('#jamais', { timeout: 120000 });

    return { message: 'Ne devrait jamais arriver.' };
  },
});
`;

/** Un bot qui depose un fichier dans son dossier de sortie. */
const BOT_QUI_DEPOSE = `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineBot, z } from '@flow/bot-sdk';

export default defineBot({
  id: 'essai.depose',
  name: 'depose',
  version: '1.0.0',
  parameters: z.object({}),
  async run({ outputDir }) {
    await writeFile(join(outputDir, 'capture.txt'), 'quelque chose', 'utf8');

    return { message: 'Fichier depose.' };
  },
});
`;

describe("Cycle de vie d'une execution", () => {
  let fixture: Fixture;
  let depot: Depot;
  let navigateurs: Navigateurs;
  let executeur: Executeur;
  let botReussi: string;
  let botSuspendu: string;
  let botQuiDepose: string;

  beforeAll(async () => {
    fixture = await createFixture('TEST-EXEC-W');
    botReussi = await fixture.deposerBot('reussi', BOT_REUSSI, SCHEMA_URL);
    botSuspendu = await fixture.deposerBot('suspendu', BOT_SUSPENDU, {
      type: 'object',
      properties: {},
    });
    botQuiDepose = await fixture.deposerBot('depose', BOT_QUI_DEPOSE, {
      type: 'object',
      properties: {},
    });

    depot = new Depot(loadEnv().WORKER_ID);
    navigateurs = new Navigateurs();
    executeur = new Executeur(depot, navigateurs);
  }, 120_000);

  afterAll(async () => {
    await navigateurs.fermerTout();
    await depot.fermer();
    await fixture.cleanup();
  }, 60_000);

  it('execute un bot, journalise au fil de l’eau et pose un denouement', async () => {
    const id = await fixture.mettreEnAttente(botReussi, {
      url: 'data:text/html,<title>Essai</title>',
    });

    await executeur.executer({ executionId: id, botId: botReussi });

    const ligne = await fixture.relire(id);

    expect(ligne.status).toBe('succeeded');
    expect(ligne.message).toContain('Essai');
    expect(ligne.output).toEqual({ vu: true });
    // La duree est mesuree et posee : une colonne vide ferait croire a une
    // execution instantanee dans les statistiques du jalon J7.
    expect(ligne.durationMs).toBeGreaterThan(0);
    expect(ligne.startedAt).not.toBeNull();
    expect(ligne.finishedAt).not.toBeNull();
    // Le worker reste inscrit sur une execution terminee : c'est la premiere
    // question quand un echec ne se reproduit que sur une machine.
    expect(ligne.workerId).toBe(loadEnv().WORKER_ID);
    // La derniere etape, et non la premiere : la progression est un etat qu'on
    // ecrase, pas un historique qu'on empile.
    expect(ligne.progressStep).toBe('Termine');
    expect(ligne.progressPercent).toBe(100);

    const journal = await fixture.journalDe(id);

    // Les rangs partent de zero et se suivent : c'est ce qui permet a un client
    // de redemander « la suite du rang n » apres une coupure.
    expect(journal.map((ligne) => ligne.seq)).toEqual([0, 1]);
    expect(journal[0]?.message).toContain('reussi');
    expect(journal[1]?.message).toContain('Navigation');
  });

  it('ne reclame pas deux fois la meme execution', async () => {
    // Le garde-fou qui empeche un bot de tourner deux fois parce qu'une machine a
    // redemarre : BullMQ redistribue de lui-meme un travail dont le verrou a
    // expire, et un bot n'est pas idempotent.
    const id = await fixture.mettreEnAttente(botReussi, {
      url: 'data:text/html,<title>Un</title>',
    });

    await executeur.executer({ executionId: id, botId: botReussi });

    const premier = await fixture.relire(id);

    await executeur.executer({ executionId: id, botId: botReussi });

    const second = await fixture.relire(id);

    // Rien n'a bouge : ni la duree, ni la fin, ni le journal.
    expect(second.finishedAt?.getTime()).toBe(premier.finishedAt?.getTime());
    expect(await fixture.journalDe(id)).toHaveLength(2);
  });

  it('interrompt un bot suspendu dans Playwright', async () => {
    const id = await fixture.mettreEnAttente(botSuspendu);
    const course = executeur.executer({ executionId: id, botId: botSuspendu });

    // On attend que le bot soit reellement en attente avant d'interrompre :
    // interrompre trop tot testerait l'annulation d'une execution pas encore
    // demarree, qui est un autre chemin.
    for (let essai = 0; essai < 100; essai += 1) {
      if ((await fixture.journalDe(id)).length >= 2) break;
      await new Promise((resoudre) => setTimeout(resoudre, 100));
    }

    const avant = Date.now();

    executeur.interrompre(id, 'annulation');
    await course;

    const ecoule = Date.now() - avant;
    const ligne = await fixture.relire(id);

    // `cancelled` et non `failed` : quelqu'un l'a demandee. Le bot a bien leve
    // une exception -- Playwright se plaint que sa page a disparu -- mais la
    // raison de l'interruption prime sur ce que l'exception raconte.
    expect(ligne.status).toBe('cancelled');
    expect(ligne.message).toBeNull();
    expect(ligne.finishedAt).not.toBeNull();

    // **Le delai est l'assertion, pas le libelle.** Sans la fermeture du contexte
    // navigateur, le signal d'abandon seul ne ferait rien : le bot resterait
    // suspendu jusqu'au delai d'attente de Playwright -- deux minutes ici -- puis
    // se terminerait `cancelled` tout de meme. Le test passerait, en mentant sur
    // ce qu'il verifie.
    //
    // Quinze secondes et non cinq : l'interruption prend une fraction de seconde
    // sur une machine au repos, mais l'integration continue fait tourner sept
    // paquets de tests et plusieurs Chromium a la fois. Une assertion serree y
    // echouerait par intermittence, ce qui est pire qu'une assertion large --
    // on finit par relancer sans lire. La marge reste de huit fois le
    // comportement sans fermeture, qui est ce qu'on veut distinguer.
    expect(ecoule).toBeLessThan(15_000);

    // Le dossier de sortie est range meme quand le bot leve. Sans cela, chaque
    // execution interrompue ou en echec laisserait un dossier vide -- pour
    // toujours, et sans que personne ne pense a le nettoyer.
    expect(existsSync(fixture.dossierDeSortie(id))).toBe(false);
  }, 120_000);

  it('refuse des parametres que le schema du bot rejette', async () => {
    // **La validation qui fait foi.** Celle de l'API porte sur le JSON Schema
    // derive ; celle-ci est le schema Zod de l'auteur, avec tout ce qu'il exprime.
    const id = await fixture.mettreEnAttente(botReussi, { url: 'pas une adresse' });

    await executeur.executer({ executionId: id, botId: botReussi });

    const ligne = await fixture.relire(id);

    expect(ligne.status).toBe('failed');
    expect(ligne.message).toMatch(/parametres invalides/i);
    // Le motif est aussi dans le journal de l'execution : c'est la que regarde
    // quelqu'un qui vient de voir son lancement echouer.
    expect((await fixture.journalDe(id)).some((l) => l.level === 'error')).toBe(true);
  });

  it('echoue proprement sur un bot retire depuis la mise en file', async () => {
    // Le cas d'une execution restee en file pendant qu'un administrateur retirait
    // le dossier du bot. Sans denouement, elle resterait `running` pour toujours.
    const id = await fixture.mettreEnAttente('essai.disparu');

    await executeur.executer({ executionId: id, botId: 'essai.disparu' });

    const ligne = await fixture.relire(id);

    expect(ligne.status).toBe('failed');
    expect(ligne.message).toMatch(/aucun bot/i);
  });

  it('rapporte par le battement de coeur une annulation ecrite en base', async () => {
    // Le chemin **fiable** de l'annulation, celui qui rattrape une diffusion
    // Redis manquee : un worker redemarre, ou reconnecte apres une coupure, voit
    // la demande ici -- au plus tard un battement apres.
    const id = await fixture.mettreEnAttente(botSuspendu);
    const course = executeur.executer({ executionId: id, botId: botSuspendu });

    for (let essai = 0; essai < 100; essai += 1) {
      if ((await fixture.journalDe(id)).length >= 2) break;
      await new Promise((resoudre) => setTimeout(resoudre, 100));
    }

    // L'intention seule, sans diffusion : exactement ce que fait l'API avant de
    // publier, et tout ce qui subsiste si la publication n'arrive jamais.
    await fixture.owner.db.execute(
      sql`UPDATE executions SET cancel_requested_at = now() WHERE id = ${id}::uuid`,
    );

    const demandees = await depot.battre(executeur.detenues());

    expect(demandees).toContain(id);

    for (const demandee of demandees) {
      executeur.interrompre(demandee, 'annulation');
    }

    await course;

    expect((await fixture.relire(id)).status).toBe('cancelled');
  }, 120_000);

  it('garde le dossier de sortie quand le bot y a depose quelque chose', async () => {
    // L'autre moitie de la regle : un dossier vide disparait, un dossier qui
    // porte une capture reste. L'effacer perdrait ce que le bot a pris la peine
    // de produire -- et c'est souvent la seule preuve de ce qu'il a vu.
    const id = await fixture.mettreEnAttente(botQuiDepose);

    await executeur.executer({ executionId: id, botId: botQuiDepose });

    expect((await fixture.relire(id)).status).toBe('succeeded');
    expect(existsSync(join(fixture.dossierDeSortie(id), 'capture.txt'))).toBe(true);

    // Et le chemin est dit dans le journal : personne ne devinerait ou regarder.
    const journal = await fixture.journalDe(id);

    expect(journal.some((ligne) => ligne.message.includes('dossier de sortie'))).toBe(true);
  });

  it("marque abandonnee une execution que l'arret du worker emporte", async () => {
    // `abandoned` et non `cancelled` : personne ne l'a demandee. Les confondre
    // effacerait la seule trace d'une panne d'infrastructure, et ferait chercher
    // un utilisateur capricieux la ou il faut lire les journaux du conteneur.
    const id = await fixture.mettreEnAttente(botSuspendu);
    const course = executeur.executer({ executionId: id, botId: botSuspendu });

    for (let essai = 0; essai < 100; essai += 1) {
      if ((await fixture.journalDe(id)).length >= 2) break;
      await new Promise((resoudre) => setTimeout(resoudre, 100));
    }

    await executeur.abandonnerTout();
    await course;

    const ligne = await fixture.relire(id);

    expect(ligne.status).toBe('abandoned');
    expect(ligne.message).toMatch(/worker arrete/i);
  }, 120_000);
});
