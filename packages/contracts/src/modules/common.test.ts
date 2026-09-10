import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, queryBoolean } from './common.js';

describe('booléen de chaîne de requête', () => {
  /**
   * Le piege que ce schema existe pour eviter : `z.coerce.boolean()` applique la
   * veracite JavaScript, ou `"false"` est une chaine non vide et vaut donc vrai.
   * Un filtre qui s'active quand on l'eteint est long a croire, donc long a
   * trouver.
   */
  it('lit « false » comme faux', () => {
    expect(queryBoolean.parse('false')).toBe(false);
    expect(queryBoolean.parse('0')).toBe(false);
  });

  it('lit « true » et « 1 » comme vrai', () => {
    expect(queryBoolean.parse('true')).toBe(true);
    expect(queryBoolean.parse('1')).toBe(true);
    expect(queryBoolean.parse(true)).toBe(true);
  });

  it('refuse ce qui n’est ni l’un ni l’autre', () => {
    // Plutot que de trancher a la place de l'appelant : « oui » n'a pas de sens
    // universel, et le silence choisirait pour lui.
    expect(queryBoolean.safeParse('oui').success).toBe(false);
    expect(queryBoolean.safeParse('').success).toBe(false);
  });
});

describe('pagination par curseur', () => {
  it('borne la taille de page demandée', () => {
    // Sans borne, un appelant peut demander la table entiere en un appel, et
    // c'est la table des executions qui est la plus grosse.
    expect(cursorQuerySchema.parse({}).limit).toBe(50);
    expect(cursorQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('accepte une limite venue d’une chaîne', () => {
    // Elle arrive d'une chaine de requete : sans coercition, toute pagination
    // depuis un navigateur serait refusee.
    expect(cursorQuerySchema.parse({ limit: '20' }).limit).toBe(20);
  });
});
