import { test as base, expect, type Page } from '@playwright/test';
import { MOT_DE_PASSE, poserLeDecor, type Decor } from './donnees.js';

/**
 * Le decor, pose une fois pour toute la campagne.
 *
 * `worker`-scoped : les parcours partagent une base, et la campagne tourne sur
 * un seul travailleur. Refaire le decor a chaque parcours ajouterait quelques
 * secondes par fichier pour un jeu de donnees qu'aucun parcours ne salit --
 * chacun cree ses propres executions et les laisse, ce qui est justement ce
 * qu'on veut voir dans l'historique.
 */
export const test = base.extend<object, { decor: Decor }>({
  decor: [
    // Le premier parametre est l'objet des fixtures, dont celle-ci n'a besoin
    // d'aucune. Playwright exige la signature ; le motif vide est sa facon de
    // dire « rien de tout cela ».
    // eslint-disable-next-line no-empty-pattern
    async ({}, utiliser: (decor: Decor) => Promise<void>) => {
      const decor = await poserLeDecor();

      await utiliser(decor);
      await decor.fermer();
    },
    { scope: 'worker' },
  ],
});

export { expect };

/**
 * Ouvre une session dans le navigateur.
 *
 * **Par l'ecran, jamais par l'API.** Un parcours qui poserait le cookie
 * lui-meme sauterait precisement ce qu'il est cense eprouver : le formulaire,
 * la reponse du serveur, la redirection, et le contexte que la coquille etablit
 * ensuite.
 */
export async function seConnecter(page: Page, identifiant: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(identifiant);
  await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // La barre de navigation n'apparait qu'une fois la session etablie et le
  // contexte lu : l'attendre vaut mieux qu'attendre une URL, qui change avant.
  await expect(page.getByRole('link', { name: 'Bots' })).toBeVisible();
}

/**
 * Nom du bot d'exemple que le depot livre.
 *
 * Les parcours en ont besoin d'un, et celui-la est le seul dont l'existence soit
 * garantie. Le nommer ici plutot que de prendre « le premier de la liste » rend
 * l'echec lisible le jour ou il manque : « Bonjour introuvable » designe la
 * cause, la ou une carte absente ne designe rien.
 */
export const BOT = 'Bonjour';

/**
 * L'adresse que le bot visite pendant les parcours : **l'application elle-meme**.
 *
 * Une premiere version pointait sur `example.com`. La campagne dependait alors
 * du reseau public : un DNS lent ou une coupure faisait echouer le parcours du
 * cycle d'execution, et l'echec designait le bot plutot que la cause. Une suite
 * de parcours qui tombe pour une raison exterieure finit par ne plus etre lue.
 *
 * L'interface est deja lancee -- la campagne l'exige -- et elle porte des liens,
 * ce que le selecteur du bot cherche.
 */
export const ADRESSE_VISITEE = process.env['E2E_BASE_URL'] ?? 'http://localhost:5273';

/**
 * Lance le bot d'exemple depuis le catalogue, et attend sa page d'execution.
 *
 * Passe par l'ecran plutot que par l'API : le formulaire est **deduit du schema
 * du bot**, et un parcours qui appellerait l'API sauterait cette deduction --
 * qui est precisement l'endroit ou une divergence entre le manifeste et le
 * formulaire se verrait.
 */
export async function lancerLeBot(page: Page, url = ADRESSE_VISITEE): Promise<void> {
  await page.goto('/bots');

  await expect(page.getByText(BOT).first()).toBeVisible();

  // Le depot ne livre qu'un bot : le premier bouton « Lancer » est le sien. Le
  // jour ou il y en aura deux, ce parcours dira lequel il veut.
  await page.getByRole('button', { name: 'Lancer', exact: true }).first().click();

  await page.getByLabel('url').fill(url);
  await page.getByLabel('selecteur').fill('a');

  await page.getByRole('button', { name: 'Lancer', exact: true }).last().click();
  await page.waitForURL(/\/executions\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

/** Ferme la session par le bouton, comme le ferait quelqu'un. */
export async function seDeconnecter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
}
