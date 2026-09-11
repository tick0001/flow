import { describe, expect, it } from 'vitest';
import { echapperCsv } from './stats.service.js';

describe('l echappement CSV', () => {
  it('laisse passer ce qui ne casse rien', () => {
    expect(echapperCsv('exemple.bonjour')).toBe('exemple.bonjour');
    expect(echapperCsv(1234)).toBe('1234');
    expect(echapperCsv(null)).toBe('');
    expect(echapperCsv(undefined)).toBe('');
  });

  it('cite ce qui casserait la colonne', () => {
    expect(echapperCsv('Bonjour, monde')).toBe('"Bonjour, monde"');
    expect(echapperCsv('Il a dit "non"')).toBe('"Il a dit ""non"""');
    expect(echapperCsv('deux\nlignes')).toBe('"deux\nlignes"');
  });

  it('neutralise les formules', () => {
    // Un tableur evalue une cellule commencant par =, +, - ou @. La colonne
    // « message » porte du texte lu sur les pages visitees par le bot : c'est
    // donc du texte que quelqu'un d'autre ecrit, ouvert sans y penser sur un
    // poste d'exploitation.
    expect(echapperCsv('=1+1')).toBe('"\'=1+1"');
    expect(echapperCsv('+33 1 23 45 67 89')).toBe('"\'+33 1 23 45 67 89"');
    expect(echapperCsv('-2 elements')).toBe('"\'-2 elements"');
    expect(echapperCsv('@import')).toBe('"\'@import"');
    expect(echapperCsv('\tdebut tabule')).toBe('"\'\tdebut tabule"');
  });

  it('ne touche pas aux nombres', () => {
    // Le tiret d'un nombre negatif n'est pas une formule : le prefixer en
    // ferait du texte que plus personne ne saurait additionner.
    expect(echapperCsv(-42)).toBe('-42');
  });

  it('ne traite pas le tiret comme un intervalle', () => {
    // « [=+-@] » couvrirait les chiffres : toute date serait alors prise pour
    // une formule. Le piege est invisible a la lecture, d'ou ce test.
    expect(echapperCsv('2026-09-11T16:13:16Z')).toBe('2026-09-11T16:13:16Z');
    expect(echapperCsv('7 elements')).toBe('7 elements');
  });
});
