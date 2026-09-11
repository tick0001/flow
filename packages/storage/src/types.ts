import type { Readable } from 'node:stream';

/** Ce qu'on apprend d'un fichier sans le lire. */
export interface Renseignements {
  size: number;
}

/**
 * Le stockage de fichiers.
 *
 * **Les captures et les traces ne vont pas en base.** L'outil remplace gardait
 * la capture d'echec dans une colonne `BLOB`, ce qui l'obligeait a definir une
 * vue allegee des executions pour que la moindre liste ne charge pas les images.
 * La base garde donc la trace d'un fichier -- son nom, son type, sa taille, sa
 * clef -- et le contenu vit ailleurs.
 *
 * L'interface est **volontairement pauvre** : ecrire, lire, decrire, supprimer.
 * Rien qui suppose un systeme de fichiers, pour qu'une implementation S3 se
 * pose sans rien changer autour. Pas de chemin, pas de `stat`, pas de
 * permissions : une clef opaque et des flux.
 *
 * Les deux processus l'utilisent. Le worker ecrit, l'API lit et sert -- **jamais
 * par un chemin statique devinable** : chaque lecture passe par une route qui
 * verifie le cloisonnement.
 */
export interface FileStore {
  /**
   * Ecrit un fichier et rend sa taille.
   *
   * La clef est fournie par l'appelant plutot que rendue : elle est deduite de
   * l'execution et de la piece, si bien que la retrouver ne demande aucune
   * recherche -- et que la purge d'une execution se fait par prefixe.
   */
  ecrire: (clef: string, contenu: Buffer | Readable) => Promise<Renseignements>;

  /** Ouvre un fichier en lecture, ou echoue s'il n'existe pas. */
  lire: (clef: string) => Promise<Readable>;

  /** Renseigne sur un fichier, ou rend `null` s'il a disparu. */
  decrire: (clef: string) => Promise<Renseignements | null>;

  /** Retire un fichier. Ne se plaint pas d'une clef deja absente. */
  supprimer: (clef: string) => Promise<void>;

  /**
   * Retire tout ce qui est sous un prefixe.
   *
   * C'est ce qui rend la purge d'une execution possible en une operation, sans
   * lister ses pieces une a une -- et donc sans dependre de ce que la base en
   * sait encore.
   */
  supprimerPrefixe: (prefixe: string) => Promise<void>;
}
