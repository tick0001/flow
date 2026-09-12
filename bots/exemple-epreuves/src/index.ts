import { defineBot, z } from '@flow/bot-sdk';

/**
 * Les quatre difficultes classiques de l'automatisation navigateur.
 *
 * Chacune est un endroit ou un bot ecrit trop vite casse, et ou la bonne facon
 * de faire n'est pas celle qui vient a l'esprit :
 *
 *  - **une boite de dialogue** bloque la page tant que personne n'y repond, et
 *    l'ecouteur doit etre pose *avant* de declencher ce qui l'ouvre ;
 *  - **un contenu differe** demande d'attendre l'element, jamais un delai fixe --
 *    un `sleep` est trop court le jour ou le reseau rame, et trop long tous les
 *    autres jours ;
 *  - **un cadre imbrique** n'est pas dans le document principal, et tout
 *    selecteur y echoue sans rien dire d'utile ;
 *  - **une page en erreur** ne leve rien toute seule : `page.goto` rend une
 *    reponse 500 sans broncher, et c'est au bot de decider que c'est un echec.
 *
 * La derniere epreuve echoue **expres**. Elle sert a montrer ce que Flow& fait
 * d'un echec : la capture au moment de la rupture, la trace Playwright, et le
 * regroupement par cause de l'ecran de pilotage.
 *
 * **Aucun parametre libre**, pour la raison dite dans `exemple-catalogue`.
 * `the-internet.herokuapp.com` est publie pour l'exercice de l'automatisation.
 */

const RACINE = 'https://the-internet.herokuapp.com';

const EPREUVES = [
  'alerte-javascript',
  'chargement-differe',
  'cadre-imbrique',
  'page-en-erreur',
] as const;

export default defineBot({
  id: 'exemple.epreuves',
  name: "Épreuves d'automatisation",
  description:
    'Traverse une difficulte classique : dialogue, contenu differe, cadre imbrique, ou page en erreur.',
  version: '1.0.0',
  author: 'Flow&',
  tags: ['exemple', 'diagnostic'],

  parameters: z.object({
    epreuve: z
      .enum(EPREUVES)
      .default('alerte-javascript')
      .describe('Difficulte a traverser. « page-en-erreur » echoue volontairement.'),
  }),

  async run({ params, page, log, progress, signal }) {
    signal.throwIfAborted();

    switch (params.epreuve) {
      case 'alerte-javascript': {
        progress('Boîte de dialogue', 30);

        await page.goto(`${RACINE}/javascript_alerts`, { waitUntil: 'domcontentloaded' });

        // **Avant** le clic, jamais apres : la boite bloque la page des qu'elle
        // s'ouvre, et un ecouteur pose ensuite n'a plus l'occasion de s'executer.
        let questionPosee = '';

        page.once('dialog', (dialogue) => {
          questionPosee = dialogue.message();
          void dialogue.accept('Flow&');
        });

        await page.click('button[onclick="jsPrompt()"]');

        const resultat = (await page.locator('#result').textContent()) ?? '';

        log('info', `Question posee : ${questionPosee}`);
        log('info', `Reponse enregistree : ${resultat}`);

        if (!resultat.includes('Flow&')) {
          throw new Error(`La page n'a pas repris la reponse donnee : « ${resultat} »`);
        }

        return { message: 'Dialogue traverse.', output: { questionPosee, resultat } };
      }

      case 'chargement-differe': {
        progress('Contenu différé', 30);

        await page.goto(`${RACINE}/dynamic_loading/2`, { waitUntil: 'domcontentloaded' });
        await page.click('#start button');

        log('info', "Attente de l'element, sans delai fixe.");

        // Playwright attend l'element lui-meme. Un `waitForTimeout` aurait
        // marche ici et casse ailleurs -- c'est exactement ce qu'on veut ne pas
        // montrer a un auteur de bot.
        const texte = page.locator('#finish h4');

        await texte.waitFor({ state: 'visible', timeout: 20_000 });

        const lu = (await texte.textContent()) ?? '';

        log('info', `Apparu : ${lu}`);

        return { message: `Contenu apparu : ${lu}`, output: { texte: lu } };
      }

      case 'cadre-imbrique': {
        progress('Cadres imbriqués', 30);

        await page.goto(`${RACINE}/nested_frames`, { waitUntil: 'domcontentloaded' });

        // Deux niveaux : le cadre du haut, puis celui du milieu a l'interieur.
        // Chercher `#content` dans le document principal ne rendrait rien, et
        // l'erreur ne dirait pas pourquoi.
        const haut = page.frameLocator('frame[name="frame-top"]');
        const milieu = haut.frameLocator('frame[name="frame-middle"]');

        const lu = (await milieu.locator('#content').textContent()) ?? '';

        log('info', `Contenu du cadre du milieu : ${lu.trim()}`);

        if (lu.trim() !== 'MIDDLE') {
          throw new Error(`Le cadre du milieu contient « ${lu.trim()}», pas « MIDDLE ».`);
        }

        return { message: 'Cadres traverses.', output: { milieu: lu.trim() } };
      }

      case 'page-en-erreur': {
        progress('Page en erreur', 30);

        const adresse = `${RACINE}/status_codes/500`;

        log('info', `Ouverture de ${adresse}`);

        const reponse = await page.goto(adresse, { waitUntil: 'domcontentloaded' });
        const code = reponse?.status() ?? 0;

        // `page.goto` ne leve pas sur un code d'erreur : la page existe, elle
        // dit juste que ca s'est mal passe. C'est au bot de trancher, et la
        // plupart oublient de le faire -- ils rapportent alors une reussite sur
        // une page d'erreur.
        if (code >= 400) {
          throw new Error(`Le serveur a repondu ${String(code)} sur ${adresse}`);
        }

        return { message: 'Page servie.', output: { code } };
      }
    }
  },
});
