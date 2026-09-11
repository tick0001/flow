import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { verifierClef } from './clefs.js';
import type { FileStore, Renseignements } from './types.js';

/**
 * Stockage sur disque : l'implementation par defaut.
 *
 * Elle suffit a une installation sur une machine, et c'est le cas courant. Un
 * deploiement a plusieurs machines demande que l'API et les workers voient le
 * meme dossier -- un volume partage -- ou une implementation S3, que l'interface
 * attend sans rien changer autour.
 *
 * **Le chemin resolu est verifie une seconde fois.** La clef est deja validee,
 * mais la verification finale porte sur le chemin absolu : c'est la seule qui
 * tienne quel que soit ce qui a compose la clef, y compris une valeur relue en
 * base qu'une version anterieure y aurait ecrite. Une defense qui depend de la
 * qualite de ses appelants n'en est pas une.
 */
export class DiskFileStore implements FileStore {
  private readonly racine: string;

  constructor(racine: string) {
    this.racine = resolve(racine);
  }

  async ecrire(clef: string, contenu: Buffer | Readable): Promise<Renseignements> {
    const chemin = this.chemin(clef);

    await mkdir(dirname(chemin), { recursive: true });

    const source = Buffer.isBuffer(contenu) ? Readable.from(contenu) : contenu;

    await pipeline(source, createWriteStream(chemin));

    const infos = await stat(chemin);

    return { size: infos.size };
  }

  async lire(clef: string): Promise<Readable> {
    const chemin = this.chemin(clef);

    // On verifie l'existence avant d'ouvrir le flux : une erreur levee dans un
    // flux deja rendu a l'appelant arrive apres les en-tetes de la reponse, et
    // se traduit alors par une connexion coupee au milieu plutot que par un 404.
    await stat(chemin);

    return createReadStream(chemin);
  }

  async decrire(clef: string): Promise<Renseignements | null> {
    try {
      const infos = await stat(this.chemin(clef));

      return { size: infos.size };
    } catch {
      return null;
    }
  }

  async supprimer(clef: string): Promise<void> {
    await rm(this.chemin(clef), { force: true });
  }

  async supprimerPrefixe(prefixe: string): Promise<void> {
    await rm(this.chemin(prefixe), { recursive: true, force: true });
  }

  private chemin(clef: string): string {
    const resolu = resolve(this.racine, verifierClef(clef));

    // `startsWith` avec le separateur : sans lui, une racine `/var/flow`
    // laisserait passer `/var/flow-autre`, qui la prefixe sans etre dedans.
    if (resolu !== this.racine && !resolu.startsWith(this.racine + sep)) {
      throw new Error(`Clef de stockage hors du dossier : ${clef}`);
    }

    return resolu;
  }
}

/** Ouvre un stockage disque, en creant sa racine si besoin. */
export async function ouvrirStockageDisque(racine: string): Promise<DiskFileStore> {
  await mkdir(resolve(racine), { recursive: true });

  return new DiskFileStore(racine);
}

/** Chemin d'un fichier dans la racine, pour les tests et l'outillage. */
export function cheminDeTest(racine: string, clef: string): string {
  return join(resolve(racine), clef);
}
