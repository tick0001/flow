import { Nuancier } from '@/pages/Nuancier';
import { Marque, Select } from '@/components/ui/primitives';
import { useTheme, type Theme } from '@/lib/theme';

/**
 * Coquille de l'application.
 *
 * Provisoire : elle n'a ni routeur ni barre latérale tant qu'il n'y a qu'un seul
 * écran, et le jalon J1 la remplace par la vraie coquille dès que la session et
 * la navigation existent. Ce qu'elle porte déjà est en revanche définitif — la
 * marque et le sélecteur de thème, qui restent en tête de barre.
 */
export function App() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen">
      <header className="border-line bg-surface sticky top-0 z-10 border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
          <Marque />
          <div className="flex-1">
            <p className="text-ink text-sm leading-tight font-bold">Flow&amp;</p>
            <p className="text-faint text-[11px] leading-tight">Automatisation navigateur</p>
          </div>
          <Select
            aria-label="Thème"
            className="w-auto"
            value={theme}
            onChange={(evenement) => {
              setTheme(evenement.target.value as Theme);
            }}
          >
            <option value="system">Système</option>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </Select>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Nuancier />
      </main>
    </div>
  );
}
