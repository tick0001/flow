// Refuse un SVG que le navigateur ne saura pas afficher.
//
// Un SVG servi par `<img>`, par `<link rel="icon">` ou par une carte Open Graph
// est analyse en **XML strict**, pas en HTML : la moindre faute de syntaxe ne
// donne pas un rendu degrade, elle donne une image vide. Et rien ne le signale,
// ni au build, ni dans la console -- l'icone manque, voila tout.
//
// Deux fautes ont reellement casse les images de ce depot, et ce sont les deux
// seules qu'un SVG ecrit a la main commet :
//
//  1. **`--` dans un commentaire.** XML l'interdit, parce que le sequenceur ne
//     saurait pas ou le commentaire se termine. C'est le tiret double qu'on
//     tape naturellement en francais pour une incise, et il a rendu le favicon
//     et l'apercu social invisibles pendant dix jours.
//  2. **`&` isole.** Il ouvre une entite : `Flow& — ...` fait attendre a
//     l'analyseur un nom d'entite qui ne vient pas. Il s'ecrit `&amp;`.
//
// Ce script ne verifie pas la grammaire XML entiere : il verifie ces deux
// regles-la. Node n'a pas d'analyseur XML, et en ajouter un pour deux regles
// serait payer une dependance pour ce que quinze lignes decident.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Les SVG suivis par git : ceux qui partent chez les autres. */
function fichiers() {
  const sortie = execFileSync('git', ['ls-files', '*.svg'], { encoding: 'utf8' });

  return sortie.split('\n').filter(Boolean);
}

/** Les entites que XML connait sans declaration, plus les references numeriques. */
const ENTITE = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function fautes(source) {
  const trouvees = [];

  // Les commentaires d'abord : leur contenu echappe aux regles sur `&`, et un
  // `&` dans un commentaire est parfaitement legal.
  const commentaires = [...source.matchAll(/<!--[\s\S]*?-->/g)];

  for (const commentaire of commentaires) {
    if (commentaire[0].slice(4, -3).includes('--')) {
      const ligne = source.slice(0, commentaire.index).split('\n').length;

      trouvees.push(`ligne ${String(ligne)} : « -- » dans un commentaire`);
    }
  }

  // Puis le reste, commentaires retires pour ne pas les relire.
  const sansCommentaires = source.replace(/<!--[\s\S]*?-->/g, (bloc) =>
    bloc.replace(/[^\n]/g, ' '),
  );

  for (const esperluette of sansCommentaires.matchAll(/&/g)) {
    if (ENTITE.test(sansCommentaires.slice(esperluette.index, esperluette.index + 12))) continue;

    const ligne = sansCommentaires.slice(0, esperluette.index).split('\n').length;

    trouvees.push(`ligne ${String(ligne)} : « & » isole, a ecrire « &amp; »`);
  }

  return trouvees;
}

let refuse = false;

for (const chemin of fichiers()) {
  const trouvees = fautes(readFileSync(chemin, 'utf8'));

  if (trouvees.length === 0) continue;

  refuse = true;
  console.error(`${chemin} :`);

  for (const faute of trouvees) console.error(`  ${faute}`);
}

if (refuse) {
  console.error("\nCes fichiers ne s'afficheront pas : un SVG est analyse en XML strict.");
  process.exit(1);
}

console.log('SVG : syntaxe XML correcte.');
