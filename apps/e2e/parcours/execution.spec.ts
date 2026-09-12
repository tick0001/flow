import { BOT, expect, lancerLeBot, seConnecter, test } from '../fixtures/parcours.js';

/**
 * Le cycle de vie d'une execution, vu du navigateur.
 *
 * **Ce parcours exige le worker.** Il n'ecoute aucun port et Playwright ne sait
 * donc pas le demarrer : il doit tourner. Sans lui, l'execution reste en file et
 * le parcours echoue sur une attente -- d'ou le message explicite plutot qu'un
 * delai depasse de trente secondes qui ne designe rien.
 *
 * Ce qui est eprouve ici ne l'est nulle part ailleurs : la chaine complete du
 * formulaire deduit du schema jusqu'a l'etat terminal affiche, en passant par la
 * file, le worker, un vrai navigateur pilote par Playwright, et le flux
 * d'evenements qui pousse le journal a l'ecran.
 */
test.describe("Parcours : le cycle de vie d'une exécution", () => {
  test('lance un bot, suit son journal, et le voit réussir', async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);
    await lancerLeBot(page);

    // L'etat part de « En file » ou « En cours » selon la vitesse du worker :
    // attendre l'un des deux exactement rendrait le parcours intermittent.
    await expect(page.getByText(BOT).first()).toBeVisible();

    // Le journal arrive pousse par le serveur, ligne a ligne. Une ligne
    // quelconque suffit : ce qu'on eprouve est que le flux arrive, pas ce que
    // le bot raconte.
    await expect(page.locator('body')).toContainText(/Réussie|Échouée/, { timeout: 90_000 });

    await expect(page.getByText('Réussie')).toBeVisible({ timeout: 5_000 });
  });

  test("l'exécution figure ensuite dans l'historique, avec sa durée", async ({ page, decor }) => {
    await seConnecter(page, decor.comptes.nord.username);
    await page.goto('/executions');

    const tableau = page.getByRole('table');

    await expect(tableau).toContainText(BOT);
    // La duree ne s'affiche qu'une fois l'execution terminee : la trouver dit
    // que le denouement a bien ete pose en base, et pas seulement diffuse.
    await expect(tableau).toContainText(/\d+[.,]?\d*\s*(s|ms|min)/);
  });

  /**
   * Le filtre par entite, qui remplace la case « inclure les sous-entites ».
   *
   * La patronne travaille sur la racine, en recursif : elle voit l'execution du
   * Nord posee par le premier parcours de ce fichier, et celle qu'elle lance
   * elle-meme sur la racine. Resserrer sur la racine seule doit faire
   * disparaitre celle du Nord -- c'est exactement ce que la case decochee
   * faisait, et c'est la seule chose qu'elle faisait.
   *
   * Elle lance son propre bot plutot que de compter sur les autres parcours :
   * le selecteur ne s'affiche qu'a partir de deux entites portant des
   * executions, et une campagne ou tout se passe dans une seule branche ne le
   * verrait jamais.
   */
  test('le filtre par entité resserre sur une entité, sans sa descendance', async ({
    page,
    decor,
  }) => {
    await seConnecter(page, decor.comptes.patronne.username);
    await lancerLeBot(page);

    await page.goto('/executions');

    // Les deux entites sont la : la racine vient d'etre servie, le Nord l'a ete
    // par le premier parcours.
    await expect(page.getByRole('table')).toContainText(decor.entites.nord.name);

    // Par role et non par etiquette : `Field` enveloppe le controle dans un
    // `<label>`, dont le texte inclut donc celui des options. Le nom accessible
    // du `<select>`, lui, est bien « Entité » -- c'est ce qu'on vise.
    const filtre = page.getByRole('combobox', { name: 'Entité', exact: true });

    await expect(filtre).toBeVisible();
    await filtre.selectOption({ label: decor.entites.racine.completeName });

    // La racine n'a aucune execution en propre venue du Nord : la ligne part.
    await expect(page.getByRole('table')).not.toContainText(decor.entites.nord.name);
    // Et la sienne reste, sans quoi le filtre aurait simplement tout vide.
    await expect(page.getByRole('table')).toContainText(decor.entites.racine.name);
  });
});
