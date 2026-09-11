/**
 * L'encart du carnet, sur la page d'une execution.
 *
 * **Ce fichier n'est pas construit, et c'est le propos.** Le contrat d'un
 * emplacement est un `render` sur un element du DOM, pas un composant React :
 * un plugin n'a donc ni a partager la version de React de l'application, ni a
 * traverser sa chaine de construction. Du JavaScript de module suffit, et ce
 * fichier le montre en restant lisible.
 *
 * Il en decoule une contrainte, assumee : le plugin dessine ses propres
 * elements. Il herite des couleurs par les variables CSS de l'application --
 * `--color-line`, `--color-muted` -- de sorte qu'un encart reste dans la page
 * sans connaitre la feuille de style qui l'entoure.
 */

/** Formate une date ISO dans la langue de la page. */
function instant(iso, langue) {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(langue);
}

function element(balise, classe, texte) {
  const noeud = document.createElement(balise);

  if (classe) noeud.setAttribute('style', classe);
  if (texte !== undefined) noeud.textContent = texte;

  return noeud;
}

/**
 * Dessine l'encart.
 *
 * @param {HTMLElement} cible ou dessiner
 * @param {{ executionId: string, locale: string, t: (clef: string) => string,
 *           vue: (nom: string, parametres?: Record<string, string>) => Promise<unknown> }} contexte
 */
export async function render(cible, contexte) {
  cible.replaceChildren();

  let notes;

  try {
    notes = await contexte.vue('notes', { executionId: contexte.executionId });
  } catch {
    // Le droit peut manquer : l'encart disparait alors, plutot que d'afficher
    // une erreur pour quelque chose que l'utilisateur n'a pas demande a voir.
    return;
  }

  if (!Array.isArray(notes) || notes.length === 0) return;

  const cadre = element('div', 'border:1px solid var(--color-line);padding:0.75rem');
  const titre = element(
    'p',
    'font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-faint)',
    contexte.locale === 'en' ? 'Notebook' : 'Carnet',
  );

  cadre.append(titre);

  const liste = element('ul', 'margin:0.5rem 0 0;padding:0;list-style:none');

  for (const note of notes) {
    const ligne = element('li', 'display:flex;gap:0.75rem;font-size:13px;padding:0.125rem 0');

    ligne.append(
      element(
        'span',
        'color:var(--color-faint);font-variant-numeric:tabular-nums;white-space:nowrap',
        instant(note.cree, contexte.locale),
      ),
      element('span', 'color:var(--color-ink)', note.texte),
    );

    liste.append(ligne);
  }

  cadre.append(liste);
  cible.append(cadre);
}

export default { render };
