import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineBot, z } from '@flow/bot-sdk';

/**
 * Bot de reference : un releve de prix sur un catalogue.
 *
 * Il sert trois choses a la fois, et c'est voulu : il montre a un auteur ce
 * qu'on attend de lui, il exerce chaque point du SDK -- journal, progression,
 * interruption, fichier produit, resultat structure --, et il tourne en test
 * d'integration permanent.
 *
 * **Aucun parametre libre.** Ni adresse, ni selecteur, ni texte. Le site est
 * ecrit en dur, la categorie se choisit dans une liste fermee, le nombre de
 * pages est borne. Ce n'est pas de la prudence de principe : Flow& se
 * demontre publiquement, et un bot qui ouvre l'adresse qu'on lui donne fait du
 * serveur qui l'heberge un relais ouvert -- vers le reseau interne de la
 * machine comme vers n'importe quel site tiers, depuis son adresse IP et sous
 * son nom de domaine. Un auteur de bot qui a besoin d'une adresse variable la
 * declare ; le bot livre avec le produit, non.
 *
 * `books.toscrape.com` est un bac a sable publie pour cet usage : un faux
 * libraire, sans donnees personnelles, dont la raison d'etre est qu'on s'y
 * exerce. Le choisir evite d'aller peser sur un site qui n'a rien demande.
 */

/** Les categories du catalogue, telles que leur adresse les nomme. */
const CATEGORIES = {
  voyage: 'travel_2',
  policier: 'mystery_3',
  'fiction-historique': 'historical-fiction_4',
  classiques: 'classics_6',
  poesie: 'poetry_23',
  philosophie: 'philosophy_7',
} as const;

const RACINE = 'https://books.toscrape.com';

/** Les etoiles sont une classe CSS, pas un nombre. */
const NOTES: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };

interface Livre {
  titre: string;
  prix: number;
  disponible: boolean;
  note: number;
}

export default defineBot({
  id: 'exemple.catalogue',
  name: 'Relevé de prix',
  description:
    "Parcourt une categorie d'un catalogue de demonstration, releve les prix, la disponibilite et les notes, et produit un CSV.",
  version: '1.0.0',
  author: 'Flow&',
  tags: ['exemple', 'extraction'],

  /**
   * Les parametres, et rien d'autre.
   *
   * `.describe()` n'est pas decoratif : le texte devient l'aide affichee sous le
   * champ, puisque le formulaire est rendu depuis le JSON Schema derive de ce
   * schema. Un parametre sans description arrive a l'ecran sans explication.
   */
  parameters: z.object({
    categorie: z
      .enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES])
      .default('voyage')
      .describe('Rayon du catalogue a relever.'),
    pages: z
      .number()
      .int()
      .min(1)
      .max(3)
      .default(1)
      .describe('Nombre de pages a parcourir, vingt livres par page.'),
    seulementDisponibles: z
      .boolean()
      .default(false)
      .describe('Ne garder que les livres annonces en stock.'),
  }),

  async run({ params, page, log, progress, signal, outputDir }) {
    const chemin = CATEGORIES[params.categorie];
    const livres: Livre[] = [];

    for (let numero = 1; numero <= params.pages; numero += 1) {
      // Entre deux pages plutot que dans une boucle serree : c'est ici que
      // l'interruption a une chance d'etre vue sans instrumenter chaque appel.
      // Playwright fermera de toute facon le contexte, mais brutalement.
      signal.throwIfAborted();

      const adresse =
        numero === 1
          ? `${RACINE}/catalogue/category/books/${chemin}/index.html`
          : `${RACINE}/catalogue/category/books/${chemin}/page-${String(numero)}.html`;

      progress(`Page ${String(numero)} sur ${String(params.pages)}`, (numero / params.pages) * 80);
      log('info', `Ouverture de ${adresse}`);

      const reponse = await page.goto(adresse, { waitUntil: 'domcontentloaded' });

      // Une categorie plus courte que le nombre de pages demande rend un 404.
      // Ce n'est pas un echec : c'est la fin du rayon, et le dire vaut mieux que
      // d'echouer sur une page vide.
      if (reponse && reponse.status() === 404) {
        log('warning', `Le rayon s'arrete a la page ${String(numero - 1)}.`);
        break;
      }

      // `$$eval` plutot qu'une boucle de locators : une seule traversee du pont
      // entre Node et la page, au lieu d'un aller-retour par champ et par livre.
      const page_ = await page.$$eval('article.product_pod', (articles) =>
        articles.map((article) => ({
          titre: article.querySelector('h3 a')?.getAttribute('title') ?? '',
          prixBrut: article.querySelector('.price_color')?.textContent ?? '',
          disponible: (article.querySelector('.availability')?.textContent ?? '').includes(
            'In stock',
          ),
          etoiles: article.querySelector('.star-rating')?.className.split(' ')[1] ?? '',
        })),
      );

      for (const brut of page_) {
        livres.push({
          titre: brut.titre,
          // Le prix est ecrit « £51.77 », parfois precede d'un caractere de
          // remplacement selon l'encodage servi : on ne garde que les chiffres.
          prix: Number.parseFloat(brut.prixBrut.replace(/[^0-9.]/g, '')),
          disponible: brut.disponible,
          note: NOTES[brut.etoiles] ?? 0,
        });
      }

      log('info', `${String(page_.length)} livre(s) sur cette page.`);
    }

    const retenus = params.seulementDisponibles ? livres.filter((l) => l.disponible) : livres;

    if (retenus.length === 0) {
      // Un rayon vide n'est pas une panne : le bot le dit et s'arrete la, plutot
      // que de produire un CSV d'une seule ligne d'en-tete.
      log('warning', 'Aucun livre retenu.');

      return { message: 'Aucun livre retenu.', output: { livres: 0 } };
    }

    progress('Ecriture du relevé', 90);

    // Le fichier est verse au stockage a la fin de l'execution et rattache a la
    // trace : c'est ce qu'on vient chercher trois jours plus tard, quand la
    // question n'est plus « est-ce que ca a tourne » mais « qu'est-ce que ca a
    // releve ».
    const csv = [
      'titre;prix;disponible;note',
      ...retenus.map((l) =>
        // Le point-virgule separe, donc il ne doit pas apparaitre dans un titre.
        [l.titre.replace(/;/g, ','), l.prix.toFixed(2), l.disponible ? 'oui' : 'non', l.note].join(
          ';',
        ),
      ),
    ].join('\n');

    await writeFile(join(outputDir, 'releve.csv'), `${csv}\n`, 'utf8');

    const prix = retenus.map((l) => l.prix).sort((a, b) => a - b);
    const median = prix[Math.floor(prix.length / 2)] ?? 0;
    const moyenne = prix.reduce((somme, p) => somme + p, 0) / prix.length;

    log('info', `Releve termine : ${String(retenus.length)} livre(s).`);

    return {
      message: `${String(retenus.length)} livre(s) relevé(s), prix médian ${median.toFixed(2)} £.`,
      output: {
        categorie: params.categorie,
        livres: retenus.length,
        prixMin: prix[0],
        prixMax: prix[prix.length - 1],
        prixMedian: Number(median.toFixed(2)),
        prixMoyen: Number(moyenne.toFixed(2)),
        noteMoyenne: Number(
          (retenus.reduce((somme, l) => somme + l.note, 0) / retenus.length).toFixed(2),
        ),
      },
    };
  },
});
