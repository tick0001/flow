import { describe, expect, it } from 'vitest';
import { botManifestSchema } from './bots.js';

const manifesteValide = {
  id: 'exemple.bonjour',
  name: 'Bonjour',
  version: '1.0.0',
  parameters: { type: 'object', properties: {} },
  sdk: 1,
};

describe('manifeste de bot', () => {
  it('accepte un manifeste minimal et remplit les défauts', () => {
    const manifeste = botManifestSchema.parse(manifesteValide);
    expect(manifeste.description).toBe('');
    expect(manifeste.author).toBe('');
    expect(manifeste.tags).toEqual([]);
  });

  it('refuse un identifiant qui ne se relit pas', () => {
    // L'identifiant se retrouve dans un journal, une clef de droit et une
    // planification. Les majuscules et les espaces y produiraient deux formes
    // du meme bot selon qui l'ecrit.
    for (const id of ['Exemple.Bonjour', 'exemple bonjour', 'ex', 'exemple..bonjour', '.exemple']) {
      expect(botManifestSchema.safeParse({ ...manifesteValide, id }).success, id).toBe(false);
    }
  });

  it('exige une version semver', () => {
    // Le SDK compare des majeures ; « v2 » ou « 1.0 » ne se comparent pas.
    expect(botManifestSchema.safeParse({ ...manifesteValide, version: '1.0' }).success).toBe(false);
    expect(botManifestSchema.safeParse({ ...manifesteValide, version: 'v1.0.0' }).success).toBe(
      false,
    );
    expect(botManifestSchema.safeParse({ ...manifesteValide, version: '1.2.3-rc.1' }).success).toBe(
      true,
    );
  });

  it('refuse une étiquette qui n’est pas normalisée', () => {
    // Sinon « Scraping », « scraping » et « scraping  » seraient trois filtres.
    expect(botManifestSchema.safeParse({ ...manifesteValide, tags: ['Scraping'] }).success).toBe(
      false,
    );
    expect(botManifestSchema.safeParse({ ...manifesteValide, tags: ['scraping'] }).success).toBe(
      true,
    );
  });
});
