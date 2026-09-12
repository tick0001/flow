import { defineBot, z } from '@flow/bot-sdk';

/**
 * Le bot minimal : celui qu'on lit en premier, et celui que les tests lancent.
 *
 * Il ne sort pas de la machine. La page qu'il visite, il la sert lui-meme --
 * `page.setContent` plutot qu'un `goto` vers une adresse. Deux raisons, et les
 * deux comptent :
 *
 *  - **il tourne partout**, y compris sur une installation coupee d'Internet,
 *    derriere un proxy d'entreprise, ou pendant une panne du site qu'il aurait
 *    visite. C'est ce qui en fait une sonde honnete : quand il echoue, c'est
 *    Flow& qui a un probleme, pas le reseau ;
 *  - **les parcours de bout en bout s'appuient dessus.** Une campagne
 *    d'integration continue qui depend d'un site tiers rougit les jours ou ce
 *    site est lent, et on finit par ne plus la regarder.
 *
 * Les trois autres bots livres -- `exemple.catalogue`, `exemple.connexion`,
 * `exemple.epreuves` -- visitent de vrais sites publics, et montrent ce que
 * Flow& sait faire. Celui-ci montre ce qu'un bot *est*.
 *
 * **Aucun parametre libre.** Ni adresse, ni selecteur, ni texte : Flow& se
 * demontre publiquement, et un bot qui ouvre l'adresse qu'on lui donne fait du
 * serveur qui l'heberge un relais ouvert -- vers son reseau interne comme vers
 * n'importe quel site tiers, depuis son adresse IP. Un auteur de bot qui a
 * besoin d'une adresse variable la declare ; les bots livres avec le produit,
 * non.
 */

/** Ce que le bot affiche, selon le decor demande. */
const DECORS = {
  liste: {
    titre: 'Inventaire de démonstration',
    corps: `
      <h1>Inventaire</h1>
      <ul id="articles">
        <li data-reference="A-100">Tournevis cruciforme — 4,90 €</li>
        <li data-reference="A-101">Marteau de menuisier — 12,50 €</li>
        <li data-reference="A-102">Niveau à bulle 40 cm — 9,80 €</li>
        <li data-reference="A-103">Mètre ruban 5 m — 6,20 €</li>
        <li data-reference="A-104">Clé à molette — 11,40 €</li>
      </ul>`,
  },
  tableau: {
    titre: 'Relevé de démonstration',
    corps: `
      <h1>Relevé</h1>
      <table id="releve">
        <tr data-reference="L-1"><td>Janvier</td><td>1 240</td></tr>
        <tr data-reference="L-2"><td>Février</td><td>1 108</td></tr>
        <tr data-reference="L-3"><td>Mars</td><td>1 471</td></tr>
      </table>`,
  },
} as const;

export default defineBot({
  id: 'exemple.bonjour',
  name: 'Bonjour',
  description:
    "Le bot minimal : il sert sa propre page, la lit, et compte ce qu'elle contient. Ne sort pas de la machine.",
  version: '2.0.0',
  author: 'Flow&',
  tags: ['exemple', 'hors-ligne'],

  /**
   * Les parametres, et rien d'autre.
   *
   * `.describe()` n'est pas decoratif : le texte devient l'aide affichee sous le
   * champ, puisque le formulaire est rendu depuis le JSON Schema derive de ce
   * schema. Un parametre sans description arrive a l'ecran sans explication.
   */
  parameters: z.object({
    decor: z
      .enum(Object.keys(DECORS) as [keyof typeof DECORS])
      .default('liste')
      .describe('Page à servir puis à lire.'),
    pause: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(0)
      .describe('Secondes à attendre avant de lire. Utile pour voir la vue en direct bouger.'),
  }),

  async run({ params, page, log, progress, signal }) {
    const decor = DECORS[params.decor];

    progress('Ouverture de la page', 20);

    // `setContent` et non `goto` : la page est celle du bot, servie depuis sa
    // propre chaine. Playwright la traite comme n'importe quelle autre -- la vue
    // en direct la montre, les selecteurs y fonctionnent, la capture d'echec la
    // saisit.
    await page.setContent(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${decor.titre}</title>` +
        `<style>body{font:16px system-ui;margin:2rem;background:#f7f4ee;color:#14120f}` +
        `h1{font-size:1.3rem}li,td{padding:.25rem .5rem}table{border-collapse:collapse}` +
        `td{border:1px solid #e2dbcf}</style></head><body>${decor.corps}</body></html>`,
      { waitUntil: 'load' },
    );

    if (params.pause > 0) {
      log('info', `Pause de ${String(params.pause)} seconde(s).`);

      // `waitForTimeout` est un mauvais reflexe dans un vrai bot -- on attend un
      // element, pas une duree. Ici c'est le sujet : le parametre existe pour
      // laisser le temps de regarder la vue en direct.
      await page.waitForTimeout(params.pause * 1000);
    }

    // Entre deux etapes plutot que dans une boucle : c'est ici que
    // l'interruption a une chance d'etre vue sans qu'on ait a instrumenter
    // chaque appel. Playwright fermera de toute facon le contexte, mais
    // brutalement.
    signal.throwIfAborted();

    progress('Lecture', 60);

    const titre = await page.title();
    const references = await page.$$eval('[data-reference]', (elements) =>
      elements.map((element) => ({
        reference: element.getAttribute('data-reference') ?? '',
        texte: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
    );

    log('info', `Titre lu : ${titre}`);
    log('info', `${String(references.length)} ligne(s) trouvée(s).`);

    progress('Terminé', 100);

    return {
      message: `${String(references.length)} ligne(s) sur « ${titre} ».`,
      output: { titre, lignes: references.length, references },
    };
  },
});
