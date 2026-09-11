import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { ArtifactKind } from '@flow/contracts';
import type { RequestContext } from '@flow/db';
import { clefDePiece, nomSain, type FileStore } from '@flow/storage';
import type { Depot } from './depot.js';
import { journalDe } from './log.js';

const log = journalDe('Pieces');

/**
 * Types de contenu des fichiers qu'un bot depose.
 *
 * Une petite table plutot qu'une bibliotheque : la liste des extensions qu'un bot
 * produit reellement est courte, et tout ce qui n'y figure pas se telecharge
 * aussi bien en flux d'octets. Un paquet de plusieurs milliers d'entrees pour ce
 * service-la serait une dependance de plus a suivre.
 */
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

export function typeDuFichier(nom: string): string {
  return TYPES[extname(nom).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Taille maximale d'un fichier verse au stockage.
 *
 * Un bot peut ecrire ce qu'il veut dans son dossier de sortie, y compris un
 * export de plusieurs giga-octets. Le refuser -- en le disant dans le journal --
 * vaut mieux que de remplir le disque de l'installation sans que personne ne
 * l'ait decide.
 */
const TAILLE_MAX = 256 * 1024 * 1024;

/**
 * Ce qu'une execution laisse derriere elle.
 *
 * **Le fichier d'abord, la ligne ensuite.** Une ligne ecrite avant le fichier
 * pointerait vers un contenu absent si l'ecriture echouait : l'interface
 * proposerait un telechargement qui rend une erreur, ce qui est pire que de ne
 * rien proposer. Dans l'autre sens, le pire cas est un fichier que personne ne
 * reference -- invisible, et ramasse par la purge du prefixe de l'execution.
 */
export class Recolte {
  constructor(
    private readonly depot: Depot,
    private readonly stockage: FileStore,
    private readonly context: RequestContext,
    private readonly executionId: string,
  ) {}

  /** Depose un contenu deja en memoire : une capture, un petit export. */
  async deposer(
    kind: ArtifactKind,
    nom: string,
    contentType: string,
    contenu: Buffer | Readable,
  ): Promise<boolean> {
    const artifactId = randomUUID();
    const clef = clefDePiece(this.executionId, artifactId, nom);

    try {
      const { size } = await this.stockage.ecrire(clef, contenu);

      await this.depot.enregistrerPiece(this.context, {
        id: artifactId,
        executionId: this.executionId,
        kind,
        name: nomSain(nom),
        contentType,
        sizeBytes: size,
        storageKey: clef,
      });

      return true;
    } catch (erreur: unknown) {
      // Une piece perdue ne doit pas priver l'execution de son denouement : le
      // bot a peut-etre fait un travail qui compte, et son resultat vaut mieux
      // que sa capture.
      log.warn(`Piece ${nom} perdue pour ${this.executionId} : ${String(erreur)}`);

      return false;
    }
  }

  /** Depose un fichier du disque, en flux : une trace pese des mega-octets. */
  async deposerFichier(kind: ArtifactKind, chemin: string, nom?: string): Promise<boolean> {
    const nomFinal = nom ?? chemin.split(/[\\/]/).pop() ?? 'fichier';

    let taille: number;

    try {
      taille = (await stat(chemin)).size;
    } catch (erreur: unknown) {
      log.debug(`Fichier absent, rien a verser : ${chemin} (${String(erreur)})`);

      return false;
    }

    if (taille > TAILLE_MAX) {
      log.warn(`Fichier trop volumineux, ignore : ${chemin} (${String(taille)} octets)`);

      return false;
    }

    return this.deposer(kind, nomFinal, typeDuFichier(nomFinal), createReadStream(chemin));
  }

  /**
   * Verse tout ce que le bot a depose dans son dossier de sortie.
   *
   * Sans recursion : un bot qui a besoin d'une arborescence produit une archive.
   * Descendre dans les sous-dossiers demanderait de decider quoi faire des noms
   * en conflit et des liens symboliques, pour un besoin que personne n'a encore.
   */
  async verserLeDossier(dossier: string): Promise<number> {
    let entrees: string[];

    try {
      entrees = (await readdir(dossier, { withFileTypes: true }))
        .filter((entree) => entree.isFile())
        .map((entree) => entree.name);
    } catch {
      return 0;
    }

    let verses = 0;

    for (const nom of entrees) {
      if (await this.deposerFichier('output', join(dossier, nom), nom)) verses += 1;
    }

    return verses;
  }
}
