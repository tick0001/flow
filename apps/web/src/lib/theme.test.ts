import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTheme } from './theme';

describe('thème', () => {
  it('démarre en « système » et ne pose aucun attribut', () => {
    // C'est l'invariant du dispositif à trois états : « système » retire
    // l'attribut au lieu d'en poser un troisième, ce qui laisse la feuille de
    // style basculer sur `prefers-color-scheme`. Poser `data-theme="system"`
    // aurait figé l'interface sur la palette claire, puisque aucune règle ne
    // correspond à cette valeur.
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('pose l’attribut pour un choix explicite, et le retire au retour au système', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      result.current.setTheme('system');
    });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('mémorise le choix sur le poste, et oublie le retour au système', () => {
    // Rien n'est stocké pour « système » : une clef absente et une clef valant
    // « system » se relisent pareil, et ne rien écrire évite d'avoir à traiter
    // les deux cas au démarrage.
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });
    expect(localStorage.getItem('flow.theme')).toBe('light');

    act(() => {
      result.current.setTheme('system');
    });
    expect(localStorage.getItem('flow.theme')).toBeNull();
  });

  it('ignore une valeur stockée qui n’a plus de sens', () => {
    // Un réglage écrit par une version antérieure, ou à la main. Le relire tel
    // quel poserait `data-theme="sepia"`, qu'aucune règle ne définit : l'écran
    // partirait sur la palette claire sans que le sélecteur l'annonce.
    localStorage.setItem('flow.theme', 'sepia');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
  });
});
