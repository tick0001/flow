import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, en, fr, isLocale, negotiateLocale, resources } from './index.js';

function cles(objet: Record<string, unknown>, prefixe = ''): string[] {
  return Object.entries(objet).flatMap(([cle, valeur]) =>
    typeof valeur === 'object' && valeur !== null
      ? cles(valeur as Record<string, unknown>, `${prefixe}${cle}.`)
      : [`${prefixe}${cle}`],
  );
}

describe('ressources de traduction', () => {
  it('couvre exactement les memes cles dans toutes les langues', () => {
    // Le typage l'impose deja a la compilation ; ce test protege le jour ou une
    // langue serait chargee depuis un fichier et non depuis le code.
    const source = cles(fr).sort();

    for (const [langue, traductions] of Object.entries(resources)) {
      expect(cles(traductions).sort(), `langue ${langue}`).toEqual(source);
    }
  });

  it('ne laisse aucune traduction vide', () => {
    // Une chaine vide passe le typage et produit un libelle invisible a l'ecran :
    // un bouton sans texte, qu'on ne remarque qu'en le cherchant.
    const vides = Object.entries(resources).flatMap(([langue, traductions]) =>
      cles(traductions)
        .filter((cle) => {
          const valeur = cle
            .split('.')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], traductions);

          return typeof valeur !== 'string' || valeur.trim().length === 0;
        })
        .map((cle) => `${langue}:${cle}`),
    );

    expect(vides).toEqual([]);
  });

  it('couvre les six statuts d’execution', () => {
    // Un statut ajoute au contrat et oublie ici s'afficherait par sa valeur
    // technique -- « abandoned » en plein ecran.
    const attendus = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'abandoned'];

    expect(Object.keys(fr.executions.statut).sort()).toEqual([...attendus].sort());
    expect(Object.keys(en.executions.statutAide).sort()).toEqual([...attendus].sort());
  });
});

describe('negotiateLocale', () => {
  it('prefere la preference explicite a l’en-tete du navigateur', () => {
    expect(negotiateLocale('en', 'fr-FR,fr;q=0.9')).toBe('en');
  });

  it('ramene une etiquette regionale a sa langue de base', () => {
    // Sans cela, un navigateur canadien annoncant `fr-CA` se verrait servir
    // l'anglais alors que le francais est disponible.
    expect(negotiateLocale('fr-CA')).toBe('fr');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
  });

  it('ignore les candidats absents ou inconnus', () => {
    expect(negotiateLocale(null, undefined, '', 'de-DE')).toBe(DEFAULT_LOCALE);
  });

  it('lit la premiere langue connue d’une liste', () => {
    expect(negotiateLocale('de-DE,de;q=0.9,en;q=0.8')).toBe('en');
  });
});

describe('isLocale', () => {
  it('n’accepte que les langues livrees', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});
