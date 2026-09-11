import { describe, expect, it } from 'vitest';
import { assainirMessage, bornerMessage } from './message.js';

describe('assainissement des messages', () => {
  it('retire la coloration que Playwright met dans ses erreurs', () => {
    // Le cas reel, releve a l'ecran : les codes ne sont invisibles que dans un
    // terminal. En base, dans l'interface ou dans un courriel, ils s'affichent
    // en clair -- et c'est le premier texte qu'on lit devant un echec.
    const brut =
      'page.goto: Timeout 30000ms exceeded. Call log:\u001b[2m - navigating to "http://x/"\u001b[22m';

    expect(assainirMessage(brut)).toBe(
      'page.goto: Timeout 30000ms exceeded. Call log: - navigating to "http://x/"',
    );
  });

  it('garde les sauts de ligne et les tabulations', () => {
    // Une trace multiligne se lit mieux avec : ce sont les seuls caracteres de
    // controle qui portent du sens dans un message.
    expect(assainirMessage('une\nligne\tindentee')).toBe('une\nligne\tindentee');
  });

  it('retire les caracteres de controle qui n’en portent pas', () => {
    expect(assainirMessage('avant\u0000apres\u0007')).toBe('avantapres');
  });

  it('borne en annoncant la coupure', () => {
    // Une troncature muette ferait chercher longtemps pourquoi un message
    // s'arrete au milieu d'un mot.
    expect(bornerMessage('abcdefghij', 5)).toBe('abcd…');
    expect(bornerMessage('abc', 5)).toBe('abc');
  });
});
