import { BOT, expect, lancerLeBot, seConnecter, test } from '../fixtures/parcours.js';

/**
 * Le cloisonnement, vu du navigateur.
 *
 * **C'est le parcours qui compte le plus.** Les tests d'integration prouvent
 * deja que la base refuse de rendre les lignes d'une autre branche ; ils le
 * prouvent en appelant les services. Ce parcours-ci verifie qu'entre la
 * politique PostgreSQL et le tableau affiche, aucune couche n'a rouvert ce que
 * la base ferme -- un filtre oublie dans une requete, un cache partage entre
 * deux sessions, une route qui rend tout.
 *
 * L'ecart vaut d'etre eprouve : c'est exactement le genre de fuite qui ne
 * produit aucune erreur, et que personne ne remarque avant qu'un client ne lise
 * le nom d'un autre.
 */
test.describe('Parcours : le cloisonnement entre branches', () => {
  test('une exécution du Nord reste invisible depuis le Sud', async ({ browser, decor }) => {
    // Deux contextes de navigateur, donc deux sessions reellement distinctes.
    // Rejouer la connexion dans le meme contexte partagerait le cookie et ne
    // prouverait rien.
    const contexteNord = await browser.newContext();
    const contexteSud = await browser.newContext();

    try {
      const nord = await contexteNord.newPage();
      const sud = await contexteSud.newPage();

      await seConnecter(nord, decor.comptes.nord.username);
      await seConnecter(sud, decor.comptes.sud.username);

      await lancerLeBot(nord);

      const identifiant = new URL(nord.url()).pathname.split('/').pop() ?? '';

      await nord.goto('/executions');
      await expect(nord.getByRole('table')).toContainText(BOT);

      // **On attend la reponse de l'API avant d'affirmer une absence.** Une
      // premiere version se contentait de « le corps de page ne contient pas
      // Nord » : l'assertion passait des le premier instant, sur une page encore
      // blanche, et ne tombait meme pas quand on coupait le cloisonnement des
      // deux cotes a la fois. Une verification qui ne peut pas echouer ne
      // verifie rien.
      const liste = sud.waitForResponse(
        (reponse) => reponse.url().includes('/api/executions') && reponse.status() === 200,
      );

      await sud.goto('/executions');
      await liste;
      await expect(sud.getByText('Aucune exécution.')).toBeVisible();
      await expect(sud.locator(`a[href*="${identifiant}"]`)).toHaveCount(0);
      await expect(sud.locator('body')).not.toContainText('PARCOURS Nord');
    } finally {
      await contexteNord.close();
      await contexteSud.close();
    }
  });

  test("le sélecteur d'entité ne propose que le périmètre habilité", async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);

    const selecteur = page.getByLabel('Changer d’entité ou de profil');

    await expect(selecteur).toContainText('PARCOURS Nord');
    // « Sud » est une entite soeur : elle n'a aucune raison d'apparaitre, et le
    // selecteur est la premiere chose qu'on regarde pour savoir ou l'on est.
    await expect(selecteur).not.toContainText('PARCOURS Sud');
  });

  test("une exécution d'une autre branche est introuvable par son adresse", async ({
    browser,
    decor,
  }) => {
    // Deviner un identifiant d'execution est improbable ; le parcours ne teste
    // pas la devinette, il teste ce qui se passe **quand on l'a**. Un lien
    // transmis, un signet, un journal partage suffisent.
    const contexteNord = await browser.newContext();
    const contexteSud = await browser.newContext();

    try {
      const nord = await contexteNord.newPage();
      const sud = await contexteSud.newPage();

      await seConnecter(nord, decor.comptes.nord.username);
      await lancerLeBot(nord);

      const adresse = new URL(nord.url()).pathname;

      await seConnecter(sud, decor.comptes.sud.username);
      await sud.goto(adresse);

      // « N'existe pas, ou n'est pas visible » : la formulation ne tranche pas,
      // et c'est delibere. Distinguer « interdit » d'« inexistant » confirmerait
      // l'existence de la ligne a qui n'a pas le droit de la voir.
      await expect(sud.getByText(/n.existe pas, ou n.est pas visible/i)).toBeVisible();
    } finally {
      await contexteNord.close();
      await contexteSud.close();
    }
  });
});
