/**
 * Client HTTP de l'API.
 *
 * Volontairement minuscule : une bibliotheque de requetes apporterait des
 * intercepteurs, des transformations et une configuration a apprendre, la ou
 * `fetch` et une trentaine de lignes suffisent -- et rendent lisible ce qui se
 * passe quand une reponse n'est pas celle qu'on attendait.
 */

/**
 * Un souci sur un champ precis.
 *
 * `code` et `params` decrivent la contrainte violee -- `required`, `format`,
 * `minLength` -- et permettent a l'interface de rendre le message dans la langue
 * du lecteur. `message` est le texte du serveur : il sert de dernier recours pour
 * une contrainte que l'interface ne sait pas encore nommer, et vaut mieux qu'un
 * champ silencieux.
 */
export interface SouciDeChamp {
  chemin: string;
  message: string;
  code?: string;
  params?: Record<string, unknown>;
}

/** Erreur portee par une reponse de l'API, avec son statut. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: SouciDeChamp[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface CorpsErreur {
  message?: string | string[];
  issues?: SouciDeChamp[];
}

async function lireErreur(reponse: Response): Promise<ApiError> {
  let corps: CorpsErreur = {};

  try {
    corps = (await reponse.json()) as CorpsErreur;
  } catch {
    // Une 502 d'un relais rend du HTML, pas du JSON. Le statut suffit alors a
    // dire ce qui se passe, et insister ferait perdre l'information.
  }

  const message = Array.isArray(corps.message)
    ? corps.message.join(' ')
    : (corps.message ?? reponse.statusText);

  return new ApiError(reponse.status, message, corps.issues);
}

async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
  let reponse: Response;

  try {
    reponse = await fetch(`/api${chemin}`, {
      // Sans cela le navigateur n'envoie pas le cookie de session, et toute
      // requete authentifiee echoue -- sans erreur explicite, puisque le
      // serveur repond simplement 401.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    // Un echec de `fetch` est un probleme de reseau, pas une reponse : le
    // distinguer d'une 500 evite d'accuser le serveur quand c'est la connexion.
    // La cause native ne dit rien d'exploitable -- `TypeError: Failed to fetch`
    // couvre aussi bien un serveur eteint qu'un blocage par extension.
    throw new ApiError(0, 'reseau');
  }

  if (!reponse.ok) throw await lireErreur(reponse);

  if (reponse.status === 204) return undefined as T;

  return (await reponse.json()) as T;
}

export const api = {
  get: <T>(chemin: string): Promise<T> => requete<T>(chemin),
  post: <T>(chemin: string, corps?: unknown): Promise<T> =>
    requete<T>(chemin, {
      method: 'POST',
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    }),
  patch: <T>(chemin: string, corps: unknown): Promise<T> =>
    requete<T>(chemin, { method: 'PATCH', body: JSON.stringify(corps) }),
  delete: <T>(chemin: string): Promise<T> => requete<T>(chemin, { method: 'DELETE' }),
};
