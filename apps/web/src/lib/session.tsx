import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { RightScope, SessionContext } from '@/lib/types';

interface Session {
  /** `undefined` tant qu'on ne sait pas encore ; `null` quand on sait qu'on n'est pas connecte. */
  context: SessionContext | null | undefined;
  chargement: boolean;
  connecter: (username: string, password: string) => Promise<void>;
  deconnecter: () => Promise<void>;
  changerContexte: (cible: {
    entityId: number;
    profileId: number;
    includeSubEntities: boolean;
  }) => Promise<void>;
  /**
   * La portee accordee pour `objet:action`, ou `undefined` si le droit manque.
   *
   * Sert a ne pas proposer ce qui sera refuse. Ce n'est **pas** un controle
   * d'acces : le serveur revalide chaque action, et cacher un bouton n'a jamais
   * empeche personne d'appeler l'API.
   */
  droit: (objet: string, action: string) => RightScope | undefined;
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<SessionContext | null> => {
      try {
        return await api.get<SessionContext>('/auth/session');
      } catch (erreur: unknown) {
        // 401 n'est pas une panne : c'est la reponse normale quand on n'est pas
        // connecte. La laisser remonter en erreur ferait clignoter un ecran
        // d'erreur avant le formulaire de connexion.
        if (erreur instanceof ApiError && erreur.status === 401) return null;

        throw erreur;
      }
    },
    // Une session revoquee ailleurs doit se voir : on relit au retour sur
    // l'onglet plutot que de faire confiance au cache indefiniment.
    refetchOnWindowFocus: true,
    retry: false,
  });

  const connexion = useMutation({
    mutationFn: (identifiants: { username: string; password: string }) =>
      api.post<SessionContext>('/auth/login', identifiants),
    onSuccess: (context) => {
      queryClient.setQueryData(['session'], context);
    },
  });

  const deconnexion = useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData(['session'], null);
      // Tout ce qui a ete lu l'a ete sous une entite et un profil donnes : le
      // garder en cache le montrerait a la personne suivante sur ce poste.
      queryClient.clear();
    },
  });

  const bascule = useMutation({
    mutationFn: (cible: { entityId: number; profileId: number; includeSubEntities: boolean }) =>
      api.post<SessionContext>('/auth/context', cible),
    onSuccess: (context) => {
      queryClient.setQueryData(['session'], context);
      // Le perimetre a change : tout ce qui a ete lu sous l'ancien est faux.
      void queryClient.invalidateQueries();
    },
  });

  const connecter = useCallback(
    async (username: string, password: string) => {
      await connexion.mutateAsync({ username, password });
    },
    [connexion],
  );

  const deconnecter = useCallback(async () => {
    await deconnexion.mutateAsync();
  }, [deconnexion]);

  const changerContexte = useCallback(
    async (cible: { entityId: number; profileId: number; includeSubEntities: boolean }) => {
      await bascule.mutateAsync(cible);
    },
    [bascule],
  );

  const droit = useCallback(
    (objet: string, action: string): RightScope | undefined => data?.rights[`${objet}:${action}`],
    [data],
  );

  const valeur = useMemo<Session>(
    () => ({
      context: isPending ? undefined : (data ?? null),
      chargement: isPending,
      connecter,
      deconnecter,
      changerContexte,
      droit,
    }),
    [data, isPending, connecter, deconnecter, changerContexte, droit],
  );

  return <SessionCtx.Provider value={valeur}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionCtx);

  if (!session) {
    throw new Error('useSession doit etre utilise sous un SessionProvider.');
  }

  return session;
}
