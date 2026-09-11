import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function reponse(corps: string, init: ResponseInit = {}): Response {
  return new Response(corps, { status: 200, ...init });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('le client de l API', () => {
  it('rend undefined quand la reponse n a pas de corps', async () => {
    // NestJS repond 201 avec un corps vide a un gestionnaire qui ne rend rien.
    // Analyser ce vide levait « Unexpected end of JSON input » -- une erreur
    // affichee a l'ecran sur un appel qui avait pourtant reussi.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse('', { status: 201 })));

    await expect(api.post('/plugins/essai/installer')).resolves.toBeUndefined();
  });

  it('rend undefined sur une 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.delete('/plugins/essai')).resolves.toBeUndefined();
  });

  it('rend le corps quand il y en a un', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse('{"id":"essai"}')));

    await expect(api.get('/plugins/essai')).resolves.toEqual({ id: 'essai' });
  });

  it('leve une ApiError qui porte le statut et le message du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponse('{"message":"Droit manquant"}', { status: 403, statusText: 'Forbidden' }),
        ),
    );

    await expect(api.get('/plugins')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Droit manquant',
    });
  });

  it('distingue une panne de reseau d une reponse du serveur', async () => {
    // « TypeError: Failed to fetch » couvre aussi bien un serveur eteint qu'un
    // blocage par extension : l'accuser d'une 500 serait faux.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api.get('/plugins')).rejects.toBeInstanceOf(ApiError);
    await expect(api.get('/plugins')).rejects.toMatchObject({ status: 0, message: 'reseau' });
  });
});
