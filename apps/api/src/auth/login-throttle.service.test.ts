import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginThrottleService } from './login-throttle.service.js';

describe('limitation des tentatives de connexion', () => {
  let throttle: LoginThrottleService;

  beforeEach(() => {
    vi.useFakeTimers();
    throttle = new LoginThrottleService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('laisse passer cinq echecs, puis bloque', () => {
    for (let essai = 0; essai < 5; essai += 1) {
      expect(throttle.isBlocked('10.0.0.1', 'admin'), `essai ${String(essai + 1)}`).toBe(false);
      throttle.registerFailure('10.0.0.1', 'admin');
    }

    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(true);
  });

  it('compte par couple adresse et identifiant, jamais par l’un des deux seul', () => {
    // Compter par identifiant seul permettrait de verrouiller le compte de
    // quelqu'un d'autre depuis n'importe ou ; compter par adresse seule
    // laisserait tout un bureau derriere une meme sortie se bloquer
    // mutuellement.
    for (let essai = 0; essai < 5; essai += 1) {
      throttle.registerFailure('10.0.0.1', 'admin');
    }

    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(true);
    // Meme compte, autre poste : pas bloque.
    expect(throttle.isBlocked('10.0.0.2', 'admin')).toBe(false);
    // Meme poste, autre compte : pas bloque non plus.
    expect(throttle.isBlocked('10.0.0.1', 'sophie')).toBe(false);
  });

  it('ignore la casse de l’identifiant', () => {
    // `citext` en base rend `Admin` et `admin` equivalents a la connexion :
    // les compter separement offrirait cinq essais gratuits par variante.
    for (let essai = 0; essai < 5; essai += 1) {
      throttle.registerFailure('10.0.0.1', 'ADMIN');
    }

    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(true);
  });

  it('oublie apres un quart d’heure', () => {
    for (let essai = 0; essai < 5; essai += 1) {
      throttle.registerFailure('10.0.0.1', 'admin');
    }

    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(false);
  });

  it('efface l’ardoise apres une connexion reussie', () => {
    for (let essai = 0; essai < 4; essai += 1) {
      throttle.registerFailure('10.0.0.1', 'admin');
    }

    throttle.reset('10.0.0.1', 'admin');

    for (let essai = 0; essai < 4; essai += 1) {
      expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(false);
      throttle.registerFailure('10.0.0.1', 'admin');
    }
  });

  it('traite une adresse absente comme une adresse a part entiere', () => {
    // Derriere un relais mal configure, `request.ip` peut manquer. Le cas ne
    // doit ni lever ni desactiver le garde-fou.
    for (let essai = 0; essai < 5; essai += 1) {
      throttle.registerFailure(undefined, 'admin');
    }

    expect(throttle.isBlocked(undefined, 'admin')).toBe(true);
    expect(throttle.isBlocked('10.0.0.1', 'admin')).toBe(false);
  });
});
