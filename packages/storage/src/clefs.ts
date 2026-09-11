/**
 * Caracteres admis dans une clef.
 *
 * Volontairement etroit. Une clef finit en chemin de fichier sur le stockage
 * disque, et tout ce qui n'est pas explicitement permis y devient une question :
 * un `..` remonte, un `:` casse sous Windows, un espace se perd dans un script.
 */
const CLEF_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Valide une clef de stockage, ou refuse.
 *
 * **Le refus est franc et le controle est central.** Une clef est composee a
 * partir d'identifiants que l'application produit, mais le nom d'un fichier
 * depose par un bot vient, lui, de l'exterieur : c'est du code arbitraire ecrit
 * par un tiers qui choisit ce nom. Un `../../etc/passwd` ecrirait alors la ou
 * personne ne l'attend.
 *
 * Verifier a l'ecriture **et** a la lecture, plutot qu'a la composition : c'est
 * la seule facon que le garde-fou tienne aussi pour une clef relue en base,
 * qu'une version anterieure aurait pu y ecrire.
 */
export function verifierClef(clef: string): string {
  if (clef.length === 0 || clef.length > 512) {
    throw new Error(`Clef de stockage invalide (longueur) : ${clef}`);
  }

  if (!CLEF_VALIDE.test(clef)) {
    throw new Error(`Clef de stockage invalide : ${clef}`);
  }

  // `..` est refuse meme entoure de caracteres admis : la regle ci-dessus
  // accepte le point, et « a/../b » y passerait.
  if (clef.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`Clef de stockage invalide (remontee) : ${clef}`);
  }

  return clef;
}

/**
 * Nettoie un nom de fichier venu d'un bot.
 *
 * On garde ce qui se lit et on remplace le reste : le nom sert a nommer le
 * telechargement, pas a retrouver le fichier -- la clef, elle, est faite
 * d'identifiants. Un nom vide apres nettoyage recoit un nom de repli, plutot que
 * de produire une clef qui se termine par une barre.
 */
export function nomSain(nom: string): string {
  const propre = nom
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120);

  return propre.length > 0 ? propre : 'fichier';
}

/**
 * Prefixe de stockage d'une execution.
 *
 * Deux niveaux de repartition tires de l'identifiant. Un dossier unique
 * contenant un sous-dossier par execution tiendrait quelques annees puis
 * deviendrait penible : lister, sauvegarder ou parcourir un dossier de plusieurs
 * centaines de milliers d'entrees est lent sur a peu pres tous les systemes de
 * fichiers.
 *
 * La repartition est **deduite de l'identifiant** et non d'une date : la purge
 * d'une execution n'a ainsi besoin que de son identifiant pour trouver ses
 * fichiers, sans relire la ligne qu'elle vient peut-etre de supprimer.
 */
export function prefixeExecution(executionId: string): string {
  const plat = executionId.replace(/-/g, '');
  const a = plat.slice(0, 2);
  const b = plat.slice(2, 4);

  return verifierClef(`executions/${a}/${b}/${executionId}`);
}

/** Clef d'une piece : le prefixe de son execution, son identifiant, son nom. */
export function clefDePiece(executionId: string, artifactId: string, nom: string): string {
  return verifierClef(`${prefixeExecution(executionId)}/${artifactId}-${nomSain(nom)}`);
}
