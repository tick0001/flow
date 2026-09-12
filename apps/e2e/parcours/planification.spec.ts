import { BOT, expect, seConnecter, test } from '../fixtures/parcours.js';

/**
 * La planification, vue du navigateur.
 *
 * Le parcours ne verifie pas qu'une occurrence se declenche : il faudrait
 * attendre la minute suivante, et un parcours qui dure une minute ne se lance
 * plus. Il verifie ce qui se voit -- la cadence est comprise, l'apercu des
 * prochains declenchements est calcule par le serveur, la planification vit dans
 * le perimetre de celui qui l'a posee, et elle se retire.
 *
 * Le declenchement lui-meme a ete eprouve en direct au jalon J6.
 */
test.describe('Parcours : la planification', () => {
  const NOM = 'PARCOURS ronde de nuit';

  test('crée une planification, la voit listée, puis la retire', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);
    await page.goto('/planifications');
    await page.getByRole('button', { name: 'Nouvelle planification' }).click();

    await page.getByLabel('Nom', { exact: true }).fill(NOM);
    // La liste deroulante se designe par ce qu'elle contient : l'etiquette
    // « Bot » enveloppe le controle, et son nom accessible emporte donc aussi
    // le texte des options -- « Bot » exact ne designe alors rien.
    await page.getByRole('combobox').filter({ hasText: BOT }).selectOption({ label: BOT });
    await page.getByLabel('Cadence').fill('0 2 * * *');

    // Les champs du bot n'apparaissent qu'une fois le bot choisi : ils sont
    // deduits de son schema, exactement comme au lancement manuel. Leurs valeurs
    // par defaut suffisent -- les laisser telles quelles verifie au passage que
    // le formulaire les reprend bien du manifeste.
    await expect(page.getByRole('combobox').filter({ hasText: 'liste' })).toBeVisible();

    // L'apercu vient du serveur : c'est lui qui dit que la cadence a ete
    // comprise, et pas seulement acceptee par le formulaire.
    await expect(page.getByText(/Prochains déclenchements/)).toBeVisible();

    await page.getByRole('button', { name: 'Créer' }).click();

    await expect(page.getByText(NOM)).toBeVisible();

    page.once('dialog', (boite) => {
      void boite.accept();
    });
    await page
      .locator('div')
      .filter({ hasText: NOM })
      .getByRole('button', { name: 'Supprimer' })
      .last()
      .click();

    await expect(page.getByText(NOM)).toHaveCount(0);
  });

  test('refuse une cadence que personne ne saurait lire', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);
    await page.goto('/planifications');
    await page.getByRole('button', { name: 'Nouvelle planification' }).click();

    await page.getByLabel('Cadence').fill('tous les mardis');

    // Le refus vient du serveur, qui analyse l'expression : l'interface ne
    // reimplemente pas cron, ce qui donnerait deux lectures possibles d'une
    // meme cadence.
    await expect(page.getByText(/cinq champs|invalide|Expression/i).first()).toBeVisible();
  });
});
