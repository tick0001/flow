import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import type { DatabaseService } from '../database/database.service.js';
import type { QueueService } from '../queue/queue.service.js';

/**
 * Ce que verifie ce fichier tient en une phrase : **le code HTTP dit la meme
 * chose que le corps**.
 *
 * La sonde de l'image Docker est `fetch(...).then(r => r.ok ? 0 : 1)`. Tant que
 * la route repondait 200 quoi qu'il arrive, cette sonde ne pouvait echouer que
 * si le processus ne repondait plus du tout -- c'est-a-dire dans le seul cas ou
 * personne n'avait besoin d'elle. Une API coupee de sa base restait au vert.
 */

function controleur(base: boolean, file: { reachable: boolean; workers: number }) {
  const db = { ping: () => Promise.resolve(base) } as unknown as DatabaseService;
  const queue = { state: () => Promise.resolve(file) } as unknown as QueueService;

  return new HealthController(db, queue);
}

/**
 * Une reponse Express reduite a ce que le controleur en utilise.
 *
 * L'espion est rendu a part plutot que lu sur l'objet : `expect(res.status)`
 * detache une methode de son objet, ce que la regle `unbound-method` refuse a
 * juste titre -- ici sans consequence, mais la regle ne peut pas le savoir.
 */
function reponse() {
  const statut = vi.fn();

  return { res: { status: statut } as unknown as Response, statut };
}

describe('la sonde de sante', () => {
  it('repond 200 quand tout repond', async () => {
    const { res, statut } = reponse();
    const corps = await controleur(true, { reachable: true, workers: 1 }).health(res);

    expect(corps.status).toBe('ok');
    expect(statut).toHaveBeenCalledWith(200);
  });

  it('repond 503 quand la base ne repond plus', async () => {
    const { res, statut } = reponse();
    const corps = await controleur(false, { reachable: true, workers: 1 }).health(res);

    expect(corps.status).toBe('degraded');
    expect(corps.checks.database).toBe(false);
    expect(statut).toHaveBeenCalledWith(503);
  });

  it('repond 503 quand la file est injoignable', async () => {
    const { res, statut } = reponse();
    const corps = await controleur(true, { reachable: false, workers: 0 }).health(res);

    expect(corps.status).toBe('degraded');
    expect(statut).toHaveBeenCalledWith(503);
  });

  it('repond 503 quand aucun worker n ecoute', async () => {
    // La base repond, la file repond, l'API sert : rien n'est en panne, et
    // pourtant aucune execution ne demarrera. C'est exactement ce qu'il faut
    // voir avant que la file ne s'allonge.
    const { res, statut } = reponse();
    const corps = await controleur(true, { reachable: true, workers: 0 }).health(res);

    expect(corps.status).toBe('degraded');
    expect(corps.checks.workers).toBe(0);
    expect(statut).toHaveBeenCalledWith(503);
  });

  it('annonce la version du manifeste, jamais 0.0.0', async () => {
    // Elle vient de `apps/api/package.json`, que la publication verifie contre
    // l'etiquette : une installation qui annonce une version qui n'est pas la
    // sienne vaut moins que pas de version du tout.
    const corps = await controleur(true, { reachable: true, workers: 1 }).health(reponse().res);

    expect(corps.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(corps.version).not.toBe('0.0.0');
  });
});
