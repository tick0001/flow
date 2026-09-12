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
 * Nom du bot que les parcours lancent.
 *
 * `exemple.bonjour` et pas un autre, et ce n'est pas indifferent : **il ne sort
 * pas de la machine**. Il sert sa propre page plutot que d'en visiter une, si
 * bien qu'une campagne ne depend ni du reseau public, ni de la disponibilite
 * d'un site tiers. Les trois autres bots livres visitent de vrais sites -- ils
 * montrent le produit, ils ne verifient pas Flow&.
 *
 * Le nommer ici plutot que de prendre « le premier de la liste » rend l'echec
 * lisible le jour ou il manque : « Bonjour introuvable » designe la cause, la ou
 * une carte absente ne designe rien.
 */
export const BOT = 'Bonjour';

/**
 * Lance le bot depuis le catalogue, et attend sa page d'execution.
 *
 * Passe par l'ecran plutot que par l'API : le formulaire est **deduit du schema
 * du bot**, et un parcours qui appellerait l'API sauterait cette deduction --
 * qui est precisement l'endroit ou une divergence entre le manifeste et le
 * formulaire se verrait.
 *
 * Aucun champ n'est rempli : les deux parametres du bot ont une valeur par
 * defaut, et les laisser telles quelles verifie au passage que le formulaire les
 * reprend bien du manifeste. Un parcours qui les ecraserait ne dirait rien de
 * ce cas-la.
 */
export async function lancerLeBot(page: Page): Promise<void> {
  await page.goto('/bots');

  // Le catalogue en livre quatre : designer « le premier » ou « le dernier »
  // bouton Lancer marchait par accident, au gre de l'ordre de lecture du
  // dossier des bots. Tout se passe donc **dans la carte du bot voulu**, qu'on
  // atteint par son titre : l'en-tete porte le titre, la carte porte l'en-tete
  // et le formulaire.
  const entete = page.getByRole('heading', { level: 3 }).filter({ hasText: BOT }).first();

  await expect(entete).toBeVisible();

  const carte = entete.locator('xpath=../..');
  const lancer = carte.getByRole('button', { name: 'Lancer', exact: true });

  // Le premier clic ouvre le formulaire, et le bouton d'en-tete devient
  // « Annuler » : le second `Lancer` de la carte est donc la soumission, et il
  // n'y en a pas deux.
  await lancer.click();
  await lancer.click();

  await page.waitForURL(/\/executions\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

/** Ferme la session par le bouton, comme le ferait quelqu'un. */
export async function seDeconnecter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
}
