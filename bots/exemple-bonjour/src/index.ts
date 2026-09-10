import { defineBot, z } from '@flow/bot-sdk';

/**
 * Bot de reference.
 *
 * Il sert trois choses a la fois, et c'est voulu : il montre a un auteur ce
 * qu'on attend de lui, il exerce chaque point du SDK, et il tourne en test
 * d'integration permanent -- si le contrat casse, c'est lui qui le dit.
 *
 * Ce qu'il fait est deliberement banal : ouvrir une page, en lire le titre,
 * compter des elements. Un exemple qui ferait quelque chose d'utile inviterait a
 * le copier sans le lire.
 */
export default defineBot({
  id: 'exemple.bonjour',
  name: 'Bonjour',
  description: "Ouvre une page, en lit le titre et compte des elements. Sert d'exemple et de test.",
  version: '1.0.0',
  author: 'Flow&',
  tags: ['exemple'],

  /**
   * Les parametres, et rien d'autre.
   *
   * `.describe()` n'est pas decoratif : le texte devient l'aide affichee sous le
   * champ, puisque le formulaire est rendu depuis le JSON Schema derive de ce
   * schema. Un parametre sans description arrive a l'ecran sans explication.
   */
  parameters: z.object({
    url: z.url().describe('Adresse de la page a ouvrir.'),
    selecteur: z
      .string()
      .min(1)
      .default('a')
      .describe('Selecteur CSS des elements a compter. Par defaut : les liens.'),
    attendreReseau: z
      .boolean()
      .default(false)
      .describe(
        'Attendre que le reseau se calme avant de lire. Utile sur une page qui charge son contenu en JavaScript, inutile ailleurs -- et lent sur une page qui garde une connexion ouverte.',
      ),
  }),

  async run({ params, page, log, progress, signal }) {
    progress('Ouverture de la page', 10);
    log('info', `Navigation vers ${params.url}`);

    await page.goto(params.url, {
      waitUntil: params.attendreReseau ? 'networkidle' : 'load',
    });

    // Entre deux etapes plutot que dans une boucle : c'est ici que
    // l'interruption a une chance d'etre vue sans qu'on ait a instrumenter
    // chaque appel. Playwright fermera de toute facon le contexte, mais
    // brutalement.
    signal.throwIfAborted();

    progress('Lecture du titre', 50);
    const titre = await page.title();

    log('info', `Titre : ${titre}`);

    progress('Comptage des elements', 80);
    // `count()` attend de lui-meme que le DOM soit stable : c'est exactement ce
    // que la facade de l'outil precedent obligeait a reecrire a la main, avec
    // des attentes explicites et des delais devines.
    const nombre = await page.locator(params.selecteur).count();

    if (nombre === 0) {
      // Un avertissement et non une erreur : zero element est un resultat, pas
      // une panne. Le distinguer laisse l'appelant decider.
      log('warning', `Aucun element ne correspond a « ${params.selecteur} ».`);
    }

    progress('Termine', 100);

    return {
      message: `« ${titre} » — ${String(nombre)} element(s) pour « ${params.selecteur} ».`,
      output: { titre, url: page.url(), selecteur: params.selecteur, nombre },
    };
  },
});
