import { defineBot, z } from '@flow/bot-sdk';

/**
 * Un bot qui ouvre une session avant de travailler.
 *
 * C'est le cas le plus courant en vrai, et celui qui manque a la plupart des
 * exemples : l'essentiel de ce qu'on automatise est derriere une authentification.
 * Ce qu'il montre tient en trois gestes -- remplir un formulaire, verifier que la
 * session est bien ouverte, et seulement ensuite aller chercher ce qu'on est venu
 * chercher.
 *
 * **La verification apres connexion n'est pas du zele.** Un formulaire soumis
 * rend presque toujours une page : sans controle, un bot qui s'est fait refuser
 * continue joyeusement et rapporte zero resultat, ce qu'on lira comme « il n'y
 * avait rien » plutot que « je ne suis pas entre ».
 *
 * **Aucun parametre libre**, pour la raison dite dans `exemple-catalogue`.
 * `quotes.toscrape.com` est un bac a sable publie pour l'exercice : son
 * formulaire de connexion accepte n'importe quel couple, et aucune donnee
 * personnelle n'y figure.
 */

const RACINE = 'https://quotes.toscrape.com';

/** Les auteurs les mieux representes du bac a sable. */
const AUTEURS = {
  'albert-einstein': 'Albert Einstein',
  'j-k-rowling': 'J.K. Rowling',
  'jane-austen': 'Jane Austen',
  'marilyn-monroe': 'Marilyn Monroe',
  'mark-twain': 'Mark Twain',
} as const;

export default defineBot({
  id: 'exemple.connexion',
  name: 'Espace connecté',
  description:
    "Ouvre une session sur un site de demonstration, verifie qu'elle a pris, puis releve les citations d'un auteur.",
  version: '1.0.0',
  author: 'Flow&',
  tags: ['exemple', 'authentification'],

  parameters: z.object({
    auteur: z
      .enum(Object.keys(AUTEURS) as [keyof typeof AUTEURS])
      .default('albert-einstein')
      .describe('Auteur dont on releve les citations.'),
    pages: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe('Nombre de pages a parcourir, dix citations par page.'),
    seConnecter: z
      .boolean()
      .default(true)
      .describe('Ouvrir une session avant de relever. Decoche : on releve en visiteur.'),
  }),

  async run({ params, page, log, progress, signal }) {
    const attendu = AUTEURS[params.auteur];

    if (params.seConnecter) {
      progress('Connexion', 10);

      await page.goto(`${RACINE}/login`, { waitUntil: 'domcontentloaded' });

      // Des identifiants quelconques : ce bac a sable les accepte tous. Un vrai
      // bot les lirait dans son environnement, jamais dans ses parametres -- un
      // parametre voyage en clair dans la trace de l'execution, que n'importe
      // qui ayant le droit de la lire pourra rouvrir dans six mois.
      await page.fill('#username', 'demonstration');
      await page.fill('#password', 'demonstration');
      await page.click('input[type="submit"]');

      // La preuve que la session a pris : le lien de deconnexion n'existe que
      // pour quelqu'un de connecte.
      const deconnexion = page.locator('a[href="/logout"]');

      if ((await deconnexion.count()) === 0) {
        // Une exception plutot qu'un journal : le bot n'a pas fait ce qu'on lui
        // demandait, et la trace doit le dire en echec, pas en reussite muette.
        throw new Error(
          "La connexion n'a pas abouti : aucun lien de deconnexion apres soumission.",
        );
      }

      log('info', 'Session ouverte.');
    }

    progress("Fiche de l'auteur", 25);

    // Le lien « (about) » de la premiere citation de cet auteur mene a sa fiche.
    // On passe par le lien plutot que par une adresse reconstruite : c'est ce
    // que ferait quelqu'un, et ca survit a un changement de forme d'URL.
    await page.goto(`${RACINE}/author/${slug(attendu)}/`, { waitUntil: 'domcontentloaded' });

    const ne = (await page.locator('.author-born-date').textContent()) ?? '';
    const lieu = (await page.locator('.author-born-location').textContent()) ?? '';

    log('info', `${attendu}, ne ${ne} ${lieu}.`);

    const citations: { texte: string; etiquettes: string[] }[] = [];

    for (let numero = 1; numero <= params.pages; numero += 1) {
      signal.throwIfAborted();

      progress(
        `Page ${String(numero)} sur ${String(params.pages)}`,
        25 + (numero / params.pages) * 65,
      );

      await page.goto(`${RACINE}/page/${String(numero)}/`, { waitUntil: 'domcontentloaded' });

      const surLaPage = await page.$$eval('.quote', (blocs) =>
        blocs.map((bloc) => ({
          auteur: bloc.querySelector('.author')?.textContent ?? '',
          texte: bloc.querySelector('.text')?.textContent ?? '',
          etiquettes: [...bloc.querySelectorAll('.tag')].map((t) => t.textContent ?? ''),
        })),
      );

      if (surLaPage.length === 0) {
        log('warning', `Plus rien a partir de la page ${String(numero)}.`);
        break;
      }

      for (const citation of surLaPage) {
        if (citation.auteur !== attendu) continue;

        citations.push({
          // Les guillemets typographiques du site encadrent chaque citation.
          texte: citation.texte.replace(/^[“"]|[”"]$/g, ''),
          etiquettes: citation.etiquettes,
        });
      }
    }

    log('info', `${String(citations.length)} citation(s) de ${attendu}.`);

    const etiquettes = [...new Set(citations.flatMap((c) => c.etiquettes))].sort();

    return {
      message: `${String(citations.length)} citation(s) de ${attendu} sur ${String(params.pages)} page(s).`,
      output: {
        auteur: attendu,
        ne: ne.replace(/^born on /, ''),
        lieu: lieu.replace(/^in /, ''),
        connecte: params.seConnecter,
        citations: citations.length,
        etiquettes,
        premiere: citations[0]?.texte ?? null,
      },
    };
  },
});

/** « Albert Einstein » devient « Albert-Einstein », comme le site les nomme. */
function slug(nom: string): string {
  return nom.replace(/\./g, '').replace(/\s+/g, '-');
}
