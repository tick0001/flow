import { expect, seConnecter, seDeconnecter, test } from '../fixtures/parcours.js';
import { MOT_DE_PASSE } from '../fixtures/donnees.js';

/**
 * La connexion.
 *
 * Le premier des quatre parcours, et le plus court. Il ne verifie pas que
 * l'authentification fonctionne -- les tests d'integration s'en chargent contre
 * la base -- mais que **le chemin complet tient** : un formulaire, un cookie,
 * une redirection, un contexte etabli, une deconnexion qui ferme vraiment.
 */
test.describe('Parcours : la connexion', () => {
  test('ouvre une session et la referme', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.patronne.username);

    // L'entite active se lit dans la coquille : c'est elle qui dit que le
    // contexte a bien ete etabli, et pas seulement que le cookie est pose.
    await expect(page.getByLabel('Changer d’entité ou de profil')).toContainText('PARCOURS Racine');

    await seDeconnecter(page);

    // La session est fermee cote serveur, et non seulement oubliee cote
    // navigateur : revenir sur une page protegee doit redemander la connexion.
    await page.goto('/executions');
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('refuse un mot de passe faux sans dire lequel des deux est en cause', async ({
    page,
    decor,
  }) => {
    await page.goto('/');
    await page.getByLabel('Identifiant').fill(decor.comptes.nord.username);
    await page.getByLabel('Mot de passe').fill('ce-n-est-pas-le-bon');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // Le message ne distingue pas l'identifiant inconnu du mot de passe faux :
    // les separer offrirait un oracle d'existence de comptes.
    await expect(page.getByText('Identifiant ou mot de passe incorrect.')).toBeVisible();
  });

  test('retrouve la session apres un rechargement', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);
    await page.reload();

    await expect(page.getByRole('link', { name: 'Bots' })).toBeVisible();
    await expect(page.getByText(decor.comptes.nord.username)).toBeVisible();
  });

  test('ne montre a un operateur que ce que son profil ouvre', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);

    // Le profil « Operateur » du decor n'a ni `user:read`, ni `profile:read`,
    // ni `plugin:read` : la rubrique des reglages n'a donc rien a montrer, et
    // ne s'affiche pas. Une rubrique vide inviterait a cliquer sur ce qui
    // refusera.
    await expect(page.getByRole('link', { name: 'Comptes' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Profils' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Exécutions', exact: true })).toBeVisible();
  });

  test('refuse un compte sans habilitation, et le dit', async ({ page, decor }) => {
    // Le seul refus que l'application explique : le compte existe et son mot de
    // passe est bon, il n'y a plus rien a proteger, et laisser la personne
    // croire a une faute de frappe la ferait recommencer indefiniment.
    const orphelin = await decor.creerCompteSansHabilitation();

    await page.goto('/');
    await page.getByLabel('Identifiant').fill(orphelin);
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.getByText(/habilité sur aucune entité/)).toBeVisible();
  });
});
