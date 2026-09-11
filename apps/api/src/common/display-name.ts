/**
 * Nom d'affichage d'un compte.
 *
 * Le prenom et le nom quand ils sont la, l'identifiant sinon -- jamais une
 * chaine vide, qui donnerait une ligne de liste sans rien dedans et un auteur
 * d'execution anonyme.
 *
 * Extrait ici parce que trois endroits en avaient besoin : la session, la liste
 * des comptes et les executions. Deux copies se toleraient ; trois se seraient
 * mises a differer, et l'ecart se serait vu dans l'interface -- la meme personne
 * nommee autrement selon l'ecran.
 */
export function displayNameOf(compte: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const parties = [compte.firstName, compte.lastName].filter(Boolean);

  return parties.length > 0 ? parties.join(' ') : compte.username;
}
