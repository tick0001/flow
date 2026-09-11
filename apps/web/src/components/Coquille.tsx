import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import { useTheme, type Theme } from '@/lib/theme';
import { Badge, Button, Checkbox, Marque, Select } from '@/components/ui/primitives';

/**
 * La coquille : barre laterale, en-tete, et la page au milieu.
 *
 * Une seule barre a tout moment. Les reglages, quand ils arriveront, la
 * remplaceront au lieu de s'y ajouter : c'est un changement de contexte, pas une
 * descente dans l'arborescence, et deux barres cote a cote maintiendraient a
 * l'ecran un travail quotidien dont on n'a que faire quand on configure.
 */

const LIENS = [
  { to: '/bots', cle: 'navigation.bots', droit: ['bot', 'read'] },
  { to: '/executions', cle: 'navigation.executions', droit: ['execution', 'read'] },
  { to: '/planifications', cle: 'navigation.planifications', droit: ['schedule', 'read'] },
  { to: '/pilotage', cle: 'navigation.statistiques', droit: ['stats', 'read'] },
] as const;

function LienBarre({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'block rounded-[2px] px-3 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-brand-soft text-brand-ink font-medium'
            : 'text-muted hover:bg-sunken hover:text-ink',
        )
      }
    >
      {children}
    </NavLink>
  );
}

/**
 * Selecteur d'entite et de profil.
 *
 * Il liste le perimetre **habilite** -- tout ce vers quoi on peut basculer --
 * qui n'est pas le perimetre de travail : ce dernier se limite a l'entite
 * choisie, et c'est lui seul qui filtre les donnees.
 */
function SelecteurContexte() {
  const { t } = useTranslation();
  const { context, changerContexte } = useSession();
  const [enCours, setEnCours] = useState(false);

  if (!context) return null;

  const actuelle = `${String(context.entity.id)}:${String(context.profile.id)}`;
  const recursifPossible = context.available.some(
    (choix) =>
      choix.entity.id === context.entity.id &&
      choix.profile.id === context.profile.id &&
      choix.isRecursive,
  );

  async function basculer(valeur: string, sousEntites: boolean): Promise<void> {
    const [entityId, profileId] = valeur.split(':').map(Number);

    if (entityId === undefined || profileId === undefined) return;

    setEnCours(true);

    try {
      await changerContexte({ entityId, profileId, includeSubEntities: sousEntites });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label={t('session.changerContexte')}
        className="w-auto max-w-xs"
        value={actuelle}
        disabled={enCours}
        onChange={(evenement) => {
          void basculer(evenement.target.value, context.includeSubEntities);
        }}
      >
        {context.available.map((choix) => (
          <option
            key={`${String(choix.entity.id)}:${String(choix.profile.id)}`}
            value={`${String(choix.entity.id)}:${String(choix.profile.id)}`}
          >
            {choix.entity.completeName} — {choix.profile.name}
          </option>
        ))}
      </Select>

      {/* La case n'apparait que si une habilitation recursive la rend
          honorable : l'afficher sans effet ferait croire a une panne. */}
      {recursifPossible && (
        <Checkbox
          label={t('session.sousEntites')}
          checked={context.includeSubEntities}
          disabled={enCours}
          onChange={(evenement) => {
            void basculer(actuelle, evenement.target.checked);
          }}
        />
      )}

      {context.includeSubEntities && <Badge ton="marque">{t('session.badgeSousEntites')}</Badge>}
    </div>
  );
}

export function Coquille() {
  const { t } = useTranslation();
  const { context, deconnecter, droit } = useSession();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex min-h-screen">
      <aside className="border-line bg-surface hidden w-56 shrink-0 flex-col border-r md:flex">
        <div className="border-line flex items-center gap-2.5 border-b px-4 py-3">
          <Marque />
          <span className="text-ink font-bold tracking-tight">Flow&amp;</span>
        </div>

        <nav className="flex-1 space-y-4 p-3">
          <div className="space-y-0.5">
            <p className="text-faint px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {t('navigation.travail')}
            </p>
            {/* Un lien n'apparait que si le droit correspondant existe : proposer
                ce qui refusera fait cliquer pour rien. */}
            {LIENS.filter((lien) => droit(lien.droit[0], lien.droit[1]) !== undefined).map(
              (lien) => (
                <LienBarre key={lien.to} to={lien.to}>
                  {t(lien.cle)}
                </LienBarre>
              ),
            )}
          </div>

          {/* La section n'apparait que si l'on a au moins un droit dedans :
              une rubrique vide invite a cliquer sur ce qui refusera. */}
          {(droit('entity', 'read') ??
            droit('user', 'read') ??
            droit('profile', 'read') ??
            droit('apikey', 'read')) && (
            <div className="space-y-0.5">
              <p className="text-faint px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                {t('navigation.reglages')}
              </p>
              {droit('entity', 'read') && <LienBarre to="/entites">{t('entites.titre')}</LienBarre>}
              {droit('user', 'read') && <LienBarre to="/comptes">{t('comptes.titre')}</LienBarre>}
              {droit('profile', 'read') && (
                <LienBarre to="/profils">{t('profils.titre')}</LienBarre>
              )}
              {droit('apikey', 'read') && <LienBarre to="/clefs">{t('clefs.titre')}</LienBarre>}
            </div>
          )}
        </nav>

        <div className="border-line space-y-2 border-t p-3">
          <Select
            aria-label={t('theme.intitule')}
            value={theme}
            onChange={(evenement) => {
              setTheme(evenement.target.value as Theme);
            }}
          >
            <option value="system">{t('theme.systeme')}</option>
            <option value="light">{t('theme.clair')}</option>
            <option value="dark">{t('theme.sombre')}</option>
          </Select>
          <p className="text-faint truncate text-xs">{context?.user.displayName}</p>
          <Button
            taille="sm"
            className="w-full"
            onClick={() => {
              void deconnecter();
            }}
          >
            {t('session.deconnexion')}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface flex flex-wrap items-center gap-3 border-b px-6 py-3">
          <SelecteurContexte />
        </header>

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
