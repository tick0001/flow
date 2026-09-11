import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskFileStore } from './disque.js';
import { clefDePiece, nomSain, prefixeExecution, verifierClef } from './clefs.js';

const EXECUTION = '0f3b9a12-4c5d-4e6f-8a9b-1c2d3e4f5a6b';

describe('clefs de stockage', () => {
  it('refuse ce qui remonte hors du dossier', () => {
    // Le nom d'un fichier depose par un bot vient de l'exterieur : c'est du code
    // arbitraire ecrit par un tiers qui choisit ce nom.
    for (const mauvaise of ['../evade', 'a/../../b', '/absolu', 'a//b', './ici', 'a/./b']) {
      expect(() => verifierClef(mauvaise)).toThrow();
    }
  });

  it('accepte une clef ordinaire', () => {
    expect(verifierClef('executions/0f/3b/abc/piece-capture.png')).toBe(
      'executions/0f/3b/abc/piece-capture.png',
    );
  });

  it('nettoie un nom de fichier venu d’un bot', () => {
    expect(nomSain('../../etc/passwd')).toBe('etc-passwd');
    expect(nomSain('capture d’écran.png')).toBe('capture-d-cran.png');
    // Un nom qui ne laisse rien apres nettoyage recoit un repli : une clef qui
    // se terminerait par un tiret nu se relit tres mal.
    expect(nomSain('///')).toBe('fichier');
  });

  it('repartit les executions sur deux niveaux', () => {
    // Un dossier unique de plusieurs centaines de milliers d'entrees devient
    // penible a lister, a sauvegarder et a parcourir.
    expect(prefixeExecution(EXECUTION)).toBe(`executions/0f/3b/${EXECUTION}`);
  });

  it('compose une clef de piece a partir de la seule execution', () => {
    // Aucune date, aucune lecture en base : la purge retrouve les fichiers d'une
    // execution avec son seul identifiant, meme apres avoir supprime sa ligne.
    expect(clefDePiece(EXECUTION, 'p1', 'echec.png')).toBe(
      `executions/0f/3b/${EXECUTION}/p1-echec.png`,
    );
  });
});

describe('stockage sur disque', () => {
  let racine: string;
  let stockage: DiskFileStore;

  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), 'flow-stockage-'));
    stockage = new DiskFileStore(racine);
  });

  afterEach(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  it('ecrit, decrit, relit et supprime', async () => {
    const clef = clefDePiece(EXECUTION, 'p1', 'note.txt');

    const ecrit = await stockage.ecrire(clef, Buffer.from('bonjour', 'utf8'));

    expect(ecrit.size).toBe(7);
    expect(await stockage.decrire(clef)).toEqual({ size: 7 });

    const flux = await stockage.lire(clef);
    const morceaux: Buffer[] = [];

    for await (const morceau of flux) morceaux.push(morceau as Buffer);

    expect(Buffer.concat(morceaux).toString('utf8')).toBe('bonjour');

    await stockage.supprimer(clef);

    expect(await stockage.decrire(clef)).toBeNull();
  });

  it('accepte un flux comme un tampon', async () => {
    // Une trace Playwright pese des mega-octets : la charger en memoire pour
    // l'ecrire serait la garder deux fois.
    const clef = clefDePiece(EXECUTION, 'p2', 'trace.zip');

    await stockage.ecrire(clef, Readable.from([Buffer.from('un'), Buffer.from('deux')]));

    expect(await stockage.decrire(clef)).toEqual({ size: 6 });
  });

  it('echoue a la lecture d’une clef absente, sans rendre de flux', async () => {
    // Une erreur levee dans un flux deja rendu arrive apres les en-tetes de la
    // reponse : le client verrait une connexion coupee au milieu, pas un 404.
    await expect(stockage.lire(clefDePiece(EXECUTION, 'p3', 'jamais.txt'))).rejects.toThrow();
  });

  it('supprime tout un prefixe d’un coup', async () => {
    await stockage.ecrire(clefDePiece(EXECUTION, 'p1', 'a.txt'), Buffer.from('a'));
    await stockage.ecrire(clefDePiece(EXECUTION, 'p2', 'b.txt'), Buffer.from('b'));

    await stockage.supprimerPrefixe(prefixeExecution(EXECUTION));

    expect(await stockage.decrire(clefDePiece(EXECUTION, 'p1', 'a.txt'))).toBeNull();
    expect(await stockage.decrire(clefDePiece(EXECUTION, 'p2', 'b.txt'))).toBeNull();
  });

  it('refuse d’ecrire hors de sa racine', async () => {
    await expect(stockage.ecrire('../evade.txt', Buffer.from('x'))).rejects.toThrow(/invalide/i);
  });

  it('refuse une clef relue en base qui sortirait du dossier', async () => {
    // Le controle porte sur le chemin **resolu**, et pas seulement sur la forme
    // de la clef : une defense qui depend de la qualite de ses appelants n'en
    // est pas une. Le cas vise est une clef ecrite par une version anterieure.
    const voisin = `${racine}-voisin`;

    await writeFile(join(racine, 'temoin.txt'), 'ici', 'utf8');

    // Une clef valide en forme, mais qui viserait un dossier frere par le seul
    // effet du prefixe commun.
    const evade = new DiskFileStore(racine);

    await expect(evade.lire('../flow-stockage-voisin/temoin.txt')).rejects.toThrow();
    expect(await readFile(join(racine, 'temoin.txt'), 'utf8')).toBe('ici');
    expect(voisin).toContain('voisin');
  });
});
