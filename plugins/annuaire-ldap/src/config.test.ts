import { describe, expect, it } from 'vitest';
import { echapperFiltre, nomDuGroupe } from './config.js';

describe("l'echappement d'un filtre LDAP", () => {
  it('laisse passer un identifiant ordinaire', () => {
    expect(echapperFiltre('a.dupont')).toBe('a.dupont');
    expect(echapperFiltre('Jean Martin')).toBe('Jean Martin');
  });

  it('neutralise ce qui ferait du filtre autre chose', () => {
    // « (uid=*) » rend le premier compte venu : l'application authentifierait
    // alors quelqu'un d'autre. C'est l'injection LDAP, et elle se corrige comme
    // sa cousine SQL -- en ne laissant jamais une saisie devenir de la syntaxe.
    expect(echapperFiltre('*')).toBe('\\2a');
    expect(echapperFiltre('a)(uid=*')).toBe('a\\29\\28uid=\\2a');
    expect(echapperFiltre('do\\main')).toBe('do\\5cmain');
  });

  it("n'echappe pas l'espace, qui n'a rien de special", () => {
    // Une premiere version l'echappait en « \\00 » -- la sequence de l'octet
    // nul. Tout identifiant compose de deux mots serait devenu introuvable.
    expect(echapperFiltre('Jean Martin')).not.toContain('\\00');
  });

  it("echappe l'octet nul, qui tronquerait le filtre", () => {
    expect(echapperFiltre(`a${String.fromCharCode(0)}b`)).toBe('a\\00b');
  });
});

describe('le nom d un groupe', () => {
  it('reduit un DN complet a son premier attribut', () => {
    // Les regles d'affectation sont ecrites par des humains, qui ecrivent
    // « Exploitation » et non le DN entier.
    expect(nomDuGroupe('CN=Exploitation,OU=Groupes,DC=flow,DC=test')).toBe('Exploitation');
    expect(nomDuGroupe('cn=lecture seule,ou=groupes,dc=flow,dc=test')).toBe('lecture seule');
  });

  it('laisse un nom nu tel quel', () => {
    expect(nomDuGroupe('Exploitation')).toBe('Exploitation');
  });
});
