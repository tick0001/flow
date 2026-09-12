import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { changerLangue } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useTheme, type Theme } from '@/lib/theme';
import {
  IconAnnuaire,
  IconBot,
  IconClef,
  IconDroits,
  IconEcran,
  IconEntites,
  IconExecution,
  IconFermer,
  IconLune,
  IconMenu,
  IconPlanning,
  IconPlugin,
  IconReglages,
  IconRetour,
  IconSoleil,
  IconSortie,
  IconStatistiques,
  IconUtilisateurs,
  type Icone,
} from '@/components/ui/icons';
import { Badge, Marque, Select } from '@/components/ui/primitives';

interface Entree {
  to: string;
  label: string;
  icone: Icone;
  /**
   * Droit qui ouvre l'ecran.
   *
   * C'est le droit que la route exige cote serveur : les deux doivent designer
   * la meme chose, faute de quoi l'entree reste visible et mene a un refus, ou
   * disparait alors qu'elle fonctionnait.
   */
  droit: [objet: string, action: string];
}

interface Groupe {
  titre: string;
  entrees: Entree[];
}

function LienBarre({ entree, onNavigate }: { entree: Entree; onNavigate: () => void }) {
  const Icone = entree.icone;

  return (
    <NavLink
      to={entree.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
          isActive
            ? 'bg-brand-soft text-brand-ink font-medium'
            : 'text-muted hover:bg-sunken hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icone className={cn('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-faint')} />
          <span className="truncate">{entree.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Selecteur de theme, en trois etats explicites. */
function SelecteurTheme() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const choix: { valeur: Theme; icone: Icone; libelle: string }[] = [
    { valeur: 'light', icone: IconSoleil, libelle: t('theme.clair') },
    { valeur: 'dark', icone: IconLune, libelle: t('theme.sombre') },
    { valeur: 'system', icone: IconEcran, libelle: t('theme.systeme') },
  ];

  return (
    <div className="border-line bg-sunken inline-flex rounded-lg border p-0.5">
      {choix.map(({ valeur, icone: Icone, libelle }) => (
        <button
          key={valeur}
          type="button"
          title={libelle}
          aria-label={libelle}
          aria-pressed={theme === valeur}
          onClick={() => {
            setTheme(valeur);
          }}
          className={cn(
            'rounded-[2px] p-1.5 transition-colors',
            theme === valeur ? 'bg-surface text-ink shadow-card' : 'text-faint hover:text-muted',
          )}
        >
          <Icone className="size-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * Selecteur d'entite et de profil.
 *
 * Il liste le perimetre **habilite** -- tout ce vers quoi on peut basculer --
 * qui n'est pas le perimetre de travail : ce dernier se limite a l'entite
 * choisie, et c'est lui seul qui filtre les donnees.
 *
 * **La descendance est toujours demandee**, et le serveur ne l'accorde que si
 * une habilitation recursive la couvre reellement. Il n'y a donc pas de case a
 * cocher : une habilitation recursive signifie qu'on repond de la branche, et
 * une bascule qui masque la moitie de ce dont on repond ne rend service a
 * personne -- c'est un filtre de liste, pas un changement de contexte. Le badge
 * reste, pour que la portee elargie se voie.
 */
function SelecteurContexte() {
  const { t } = useTranslation();
  const { context, changerContexte } = useSession();
  const [enCours, setEnCours] = useState(false);

  if (!context) return null;

  const actuelle = `${String(context.entity.id)}:${String(context.profile.id)}`;

  async function basculer(valeur: string): Promise<void> {
    const [entityId, profileId] = valeur.split(':').map(Number);

    if (entityId === undefined || profileId === undefined) return;

    setEnCours(true);

    try {
      await changerContexte({ entityId, profileId, includeSubEntities: true });
    } finally {
      setEnCours(false);
    }
  }

  return (
    // Une seule ligne, sans retour : l'en-tete fait 56 px de haut, et un
    // `flex-wrap` y empilait trois controles sur un telephone -- le selecteur
    // sortait alors par le haut de la barre, a moitie coupe.
    <div className="flex min-w-0 items-center gap-3">
      <Select
        aria-label={t('session.changerContexte')}
        className="h-8 w-auto max-w-xs min-w-0 truncate"
        value={actuelle}
        disabled={enCours}
        onChange={(evenement) => {
          void basculer(evenement.target.value);
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

      {/* Le badge dit la portee, il ne la change pas : masque sous `sm`, ou la
          barre n'a pas de quoi le loger a cote du selecteur. */}
      {context.includeSubEntities && (
        <span className="hidden shrink-0 sm:inline">
          <Badge ton="marque">{t('session.badgeSousEntites')}</Badge>
        </span>
      )}
    </div>
  );
}

/** Initiales d'un nom affiche, pour la pastille d'identite. */
function initiales(nom: string): string {
  const morceaux = nom.trim().split(/\s+/).slice(0, 2);

  return morceaux.map((morceau) => morceau[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * La coquille : barre laterale, en-tete, et la page au milieu.
 *
 * **Une seule barre a tout moment.** Les reglages remplacent la navigation du
 * travail au lieu de s'y ajouter : c'est un changement de contexte, pas une
 * descente dans l'arborescence, et deux rubriques cote a cote gardaient a
 * l'ecran un travail quotidien dont on n'a que faire quand on configure. On y
 * entre par le pied de barre, on en sort par le retour place en tete.
 *
 * Barre fixe sur grand ecran, tiroir sur petit. Sans le tiroir, la barre
 * disparaissait sous 768 px et l'application devenait injoignable au telephone :
 * il ne restait aucun moyen d'atteindre un autre ecran.
 */
export function Coquille() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { context, deconnecter, droit } = useSession();
  const [ouvert, setOuvert] = useState(false);

  const travail: Groupe[] = [
    {
      titre: t('navigation.travail'),
      entrees: [
        { to: '/bots', label: t('navigation.bots'), icone: IconBot, droit: ['bot', 'read'] },
        {
          to: '/executions',
          label: t('navigation.executions'),
          icone: IconExecution,
          droit: ['execution', 'read'],
        },
        {
          to: '/planifications',
          label: t('navigation.planifications'),
          icone: IconPlanning,
          droit: ['schedule', 'read'],
        },
        {
          to: '/pilotage',
          label: t('navigation.statistiques'),
          icone: IconStatistiques,
          droit: ['stats', 'read'],
        },
      ],
    },
  ];

  const reglages: Groupe[] = [
    {
      titre: t('navigation.reglages'),
      entrees: [
        {
          to: '/entites',
          label: t('entites.titre'),
          icone: IconEntites,
          droit: ['entity', 'read'],
        },
        {
          to: '/comptes',
          label: t('comptes.titre'),
          icone: IconUtilisateurs,
          droit: ['user', 'read'],
        },
        {
          to: '/profils',
          label: t('profils.titre'),
          icone: IconDroits,
          droit: ['profile', 'read'],
        },
        { to: '/clefs', label: t('clefs.titre'), icone: IconClef, droit: ['apikey', 'read'] },
        {
          to: '/annuaire',
          label: t('annuaire.titre'),
          icone: IconAnnuaire,
          droit: ['directory', 'read'],
        },
        {
          to: '/extensions',
          label: t('plugins.titre'),
          icone: IconPlugin,
          droit: ['plugin', 'read'],
        },
      ],
    },
  ];

  /**
   * Retire ce que le profil actif ne peut pas ouvrir.
   *
   * Un groupe vide de toutes ses entrees disparait avec elles : garder son
   * titre seul afficherait une rubrique qui ne mene nulle part, ce qui se lit
   * comme une panne plutot que comme une absence de droit.
   */
  function filtrer(groupes: Groupe[]): Groupe[] {
    return groupes
      .map((groupe) => ({
        ...groupe,
        entrees: groupe.entrees.filter(
          (entree) => droit(entree.droit[0], entree.droit[1]) !== undefined,
        ),
      }))
      .filter((groupe) => groupe.entrees.length > 0);
  }

  const configurables = filtrer(reglages);
  const cheminsDeReglage = configurables.flatMap((groupe) =>
    groupe.entrees.map((entree) => entree.to),
  );
  const dansConfiguration = cheminsDeReglage.some((chemin) => location.pathname.startsWith(chemin));

  const sections = dansConfiguration ? configurables : filtrer(travail);

  // Le tiroir se referme a chaque navigation : le laisser ouvert masquerait la
  // page qu'on vient de demander.
  useEffect(() => {
    setOuvert(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Voile du tiroir, sur petit ecran seulement. */}
      {ouvert && (
        <button
          type="button"
          aria-label={t('navigation.fermerMenu')}
          onClick={() => {
            setOuvert(false);
          }}
          className="bg-ink/30 fixed inset-0 z-30 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'border-line bg-surface fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform lg:static lg:translate-x-0',
          ouvert ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          {dansConfiguration ? (
            <NavLink
              to="/bots"
              className="text-muted hover:text-ink flex min-w-0 items-center gap-2 text-sm font-medium transition-colors"
            >
              <IconRetour className="size-4 shrink-0" />
              <span className="truncate">{t('navigation.retour')}</span>
            </NavLink>
          ) : (
            <>
              <Marque />
              <span className="text-base font-semibold tracking-tight">Flow&amp;</span>
            </>
          )}

          <button
            type="button"
            aria-label={t('navigation.fermerMenu')}
            onClick={() => {
              setOuvert(false);
            }}
            className="text-faint hover:text-ink ml-auto rounded-md p-1 lg:hidden"
          >
            <IconFermer className="size-5" />
          </button>
        </div>

        {dansConfiguration && (
          <div className="border-line border-b px-4 pb-3">
            <h2 className="text-base font-semibold tracking-tight">{t('navigation.reglages')}</h2>
            <p className="text-muted text-xs">{t('navigation.reglagesIntro')}</p>
          </div>
        )}

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {sections.map((groupe) => (
            <div key={groupe.titre} className="space-y-1">
              <p className="text-faint px-2.5 text-[11px] font-semibold tracking-wider uppercase">
                {groupe.titre}
              </p>
              {groupe.entrees.map((entree) => (
                <LienBarre
                  key={entree.to}
                  entree={entree}
                  onNavigate={() => {
                    setOuvert(false);
                  }}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-line space-y-1 border-t p-3">
          {/* Les reglages sont en pied de barre, separes du travail quotidien :
              on les ouvre rarement, et jamais par erreur.

              Rien a configurer, pas d'entree : proposer une zone dont tous les
              ecrans sont refuses reviendrait a annoncer une porte muree. */}
          {!dansConfiguration && configurables[0]?.entrees[0] && (
            <NavLink
              to={configurables[0].entrees[0].to}
              className="text-muted hover:bg-sunken hover:text-ink flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
            >
              <IconReglages className="text-faint size-[18px] shrink-0" />
              <span>{t('navigation.reglages')}</span>
            </NavLink>
          )}

          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="bg-brand-soft text-brand-ink grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
              {initiales(context?.user.displayName ?? '')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {context?.user.displayName}
              </span>
              <span className="text-faint block truncate text-xs">{context?.profile.name}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                void deconnecter();
              }}
              title={t('session.deconnexion')}
              aria-label={t('session.deconnexion')}
              className="text-faint hover:bg-sunken hover:text-ink rounded-md p-1.5 transition-colors"
            >
              <IconSortie className="size-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-line bg-surface sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 sm:px-6">
          <button
            type="button"
            aria-label={t('navigation.ouvrirMenu')}
            onClick={() => {
              setOuvert(true);
            }}
            className="text-muted hover:bg-sunken hover:text-ink rounded-md p-1.5 lg:hidden"
          >
            <IconMenu className="size-5" />
          </button>

          {/* Le selecteur prend la place restante et sait retrecir : sur
              telephone, la barre n'a pas de quoi loger un nom d'entite entier. */}
          <div className="min-w-0 flex-1">
            <SelecteurContexte />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <SelecteurTheme />

            <select
              value={i18n.language}
              aria-label={t('navigation.langue')}
              onChange={(evenement) => {
                changerLangue(evenement.target.value);
              }}
              className="border-line bg-surface text-muted hover:border-line-strong hidden h-8 rounded-lg border px-2 text-xs transition-colors sm:block"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </header>

        {/* Largeur maximale : au-dela, une ligne de tableau devient illisible
            parce que l'oeil perd la ligne entre la premiere et la derniere
            colonne. */}
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
