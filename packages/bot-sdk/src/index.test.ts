import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SDK_MAJOR, defineBot, toManifest } from './index.js';

const bot = defineBot({
  id: 'exemple.essai',
  name: 'Essai',
  version: '1.0.0',
  parameters: z.object({
    url: z.url().describe('Adresse a visiter'),
    profond: z.boolean().default(false).describe('Suivre les liens'),
    etiquette: z.string().optional(),
  }),
  run: () => Promise.resolve({ message: 'fait' }),
});

describe('defineBot', () => {
  it('pose la version majeure du SDK', () => {
    // Le worker la compare au chargement : un bot compile contre une majeure
    // qu'il ne sait plus servir est refuse avec ce motif, plutot qu'execute
    // avec un contexte dont un champ a change de sens.
    expect(bot.sdk).toBe(SDK_MAJOR);
  });
});

describe('manifeste derive', () => {
  const manifeste = toManifest(bot);

  it('derive le JSON Schema depuis le schema Zod', () => {
    // Une seule description des parametres : elle valide a l'execution, type
    // `params` a la compilation, et dessine le formulaire. Deux descriptions
    // finiraient par se contredire.
    const parametres = manifeste.parameters as {
      properties: Record<string, { type?: string; description?: string; default?: unknown }>;
      required?: string[];
    };

    expect(parametres.properties['url']?.type).toBe('string');
    expect(parametres.properties['url']?.description).toBe('Adresse a visiter');
    expect(parametres.properties['profond']?.default).toBe(false);
  });

  it('n’annonce obligatoire que ce qu’il faut réellement saisir', () => {
    // `io: 'input'` decrit ce qu'on saisit et non ce que le schema produit. En
    // sortie, `profond` est toujours present -- il a une valeur par defaut --
    // et le formulaire l'exigerait donc a tort.
    const parametres = manifeste.parameters as { required?: string[] };

    expect(parametres.required).toEqual(['url']);
  });

  it('remplit les champs facultatifs du manifeste', () => {
    expect(manifeste.description).toBe('');
    expect(manifeste.author).toBe('');
    expect(manifeste.tags).toEqual([]);
  });

  it('refuse un identifiant qui ne se relit pas', () => {
    // L'identifiant se retrouve dans un journal, une clef de droit et une
    // planification : les majuscules et les espaces y produiraient deux formes
    // du meme bot selon qui l'ecrit.
    const fautif = defineBot({ ...bot, id: 'Exemple Essai' });

    expect(() => toManifest(fautif)).toThrow();
  });

  it('refuse une version qui ne se compare pas', () => {
    const fautif = defineBot({ ...bot, version: 'v1' });

    expect(() => toManifest(fautif)).toThrow();
  });
});
