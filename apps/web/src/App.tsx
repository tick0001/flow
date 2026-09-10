import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { Coquille } from '@/components/Coquille';
import { Connexion } from '@/pages/Connexion';
import { Entites } from '@/pages/Entites';
import { MotDePasse } from '@/pages/MotDePasse';
import { Nuancier } from '@/pages/Nuancier';

/**
 * Un client de requetes unique, cree hors du composant.
 *
 * Le creer dans le rendu en produirait un neuf a chaque re-rendu, et tout le
 * cache serait perdu a chaque frappe dans un champ.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Une donnee relue a chaque montage de composant produit une rafale de
      // requetes en navigation ; trente secondes suffisent a l'eviter sans
      // afficher des chiffres perimes.
      staleTime: 30_000,
      retry: false,
    },
  },
});

/**
 * Aiguillage selon l'etat de la session.
 *
 * Trois etats et non deux : on ne sait pas encore, on n'est pas connecte, on
 * l'est. Confondre le premier et le deuxieme ferait clignoter l'ecran de
 * connexion a chaque rechargement, avant que la session ne revienne.
 */
function Racine() {
  const { context, chargement } = useSession();
  const { t } = useTranslation();

  if (chargement) {
    return (
      <div className="text-muted flex min-h-screen items-center justify-center text-sm">
        {t('commun.chargement')}
      </div>
    );
  }

  if (!context) return <Connexion />;

  // Le changement impose remplace l'application entiere : proposer une
  // navigation a cote laisserait quelqu'un travailler des mois avec le mot de
  // passe qu'un guide d'installation publie.
  if (context.user.mustChangePassword) return <MotDePasse />;

  return (
    <Routes>
      <Route element={<Coquille />}>
        <Route path="/entites" element={<Entites />} />
        <Route path="/nuancier" element={<Nuancier />} />
        {/* Les bots et les executions arrivent aux jalons J2 et J3. En attendant,
            la racine mene aux entites : une route qui n'existe pas encore vaut
            mieux vide que fausse. */}
        <Route path="*" element={<Navigate to="/entites" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <Racine />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
