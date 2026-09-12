import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { Coquille } from '@/components/Coquille';
import { Connexion } from '@/pages/Connexion';
import { Bots } from '@/pages/Bots';
import { Comptes } from '@/pages/Comptes';
import { Clefs } from '@/pages/Clefs';
import { Entites } from '@/pages/Entites';
import { Pilotage } from '@/pages/Pilotage';
import { Plugins } from '@/pages/Plugins';
import { ReglesDeBots } from '@/pages/ReglesDeBots';
import { Annuaire } from '@/pages/Annuaire';
import { Planifications } from '@/pages/Planifications';
import { Execution } from '@/pages/Execution';
import { Executions } from '@/pages/Executions';
import { Profils } from '@/pages/Profils';
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
        <Route path="/bots" element={<Bots />} />
        <Route path="/executions" element={<Executions />} />
        <Route path="/executions/:id" element={<Execution />} />
        <Route path="/planifications" element={<Planifications />} />
        <Route path="/clefs" element={<Clefs />} />
        <Route path="/pilotage" element={<Pilotage />} />
        <Route path="/extensions" element={<Plugins />} />
        <Route path="/annuaire" element={<Annuaire />} />
        <Route path="/regles-de-bots" element={<ReglesDeBots />} />
        <Route path="/entites" element={<Entites />} />
        <Route path="/comptes" element={<Comptes />} />
        <Route path="/profils" element={<Profils />} />
        <Route path="/nuancier" element={<Nuancier />} />
        {/* La racine mene au catalogue : lancer est ce qu'on vient faire, et
            l'historique se consulte apres. */}
        <Route path="*" element={<Navigate to="/bots" replace />} />
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
