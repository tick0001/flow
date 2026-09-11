import { describe, expect, it } from 'vitest';
import { logLevelSchema } from '@flow/contracts';
import { echapperLike, GRAVITES_A_PARTIR_DE } from './executions.service.js';

describe('recherche dans les journaux', () => {
  it('echappe ce qui a un sens dans un motif', () => {
    // Chercher « 100% » sans echapper rendrait **toutes** les lignes : le
    // pourcentage signifie « n'importe quoi » dans un motif LIKE. Le contresens
    // est silencieux, ce qui est le pire genre -- on croit que le filtre ne
    // marche pas, alors qu'il marche trop bien.
    expect(echapperLike('100%')).toBe('100\\%');
    expect(echapperLike('a_b')).toBe('a\\_b');
    // L'antislash lui-meme s'echappe, sans quoi un chemin Windows cherche dans
    // un journal echapperait le caractere suivant.
    expect(echapperLike('C:\\chemin')).toBe('C:\\\\chemin');
  });

  it('laisse intact ce qui n’a pas de sens special', () => {
    // Un selecteur CSS ou un identifiant doivent traverser tels quels : c'est
    // exactement ce qu'on cherche dans un journal d'execution.
    expect(echapperLike('#form > input[name="url"]')).toBe('#form > input[name="url"]');
    expect(echapperLike('ETIMEDOUT')).toBe('ETIMEDOUT');
  });
});

describe('filtre par gravite', () => {
  it('couvre chaque niveau declare par le contrat', () => {
    // La table est ecrite a la main plutot que deduite de l'ordre du type
    // PostgreSQL. Ce test est ce qui empeche la liste de devenir incomplete :
    // sans lui, ajouter un niveau au contrat donnerait un filtre qui ne rend
    // rien, sans qu'aucune erreur ne le dise.
    for (const niveau of logLevelSchema.options) {
      expect(GRAVITES_A_PARTIR_DE[niveau]).toBeDefined();
      // Un niveau se contient toujours lui-meme.
      expect(GRAVITES_A_PARTIR_DE[niveau]).toContain(niveau);
    }
  });

  it('ordonne les gravites de la plus bavarde a la plus grave', () => {
    // « A partir de l'avertissement » doit vouloir dire « avertissements et
    // erreurs », pas « avertissements seuls ».
    expect(GRAVITES_A_PARTIR_DE['debug']).toBe('{debug,info,warning,error}');
    expect(GRAVITES_A_PARTIR_DE['warning']).toBe('{warning,error}');
    expect(GRAVITES_A_PARTIR_DE['error']).toBe('{error}');
  });
});
