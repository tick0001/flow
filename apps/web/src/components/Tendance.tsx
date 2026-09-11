import { useTranslation } from 'react-i18next';
import type { JourStats } from '@/lib/types';

/** Hauteur du trace, en unites de son repere. La largeur suit le conteneur. */
const HAUTEUR = 120;
const LARGEUR = 720;

/**
 * Gouttiere de gauche, pour les graduations.
 *
 * Sans elle les etiquettes se posaient sur la premiere barre : un chiffre gris
 * sur un rectangle vert, illisible des deux cotes.
 */
const GOUTTIERE = 26;

/**
 * Air au-dessus du maximum.
 *
 * L'etiquette d'une graduation se dessine **au-dessus** de son filet ; celle du
 * maximum tombait donc a trois pixels au-dessus du cadre, c'est-a-dire hors
 * champ. Le dessin perdait la seule graduation qui donne son echelle -- et rien
 * ne le signalait, puisqu'un depassement de `viewBox` ne fait qu'effacer.
 */
const MARGE = 12;

/** Largeur reellement disponible pour les barres. */
const TRACE = LARGEUR - GOUTTIERE;

/**
 * La tendance, en barres empilees.
 *
 * **Dessinee a la main, sans bibliotheque de graphiques.** Une bibliotheque
 * apporterait des degrades, des ombres portees, des animations d'entree et une
 * infobulle flottante -- c'est-a-dire l'exact contraire de l'ecriture de cette
 * application, ou rien ne flotte et ou un filet vaut mieux qu'une ombre. Il
 * faudrait alors passer du temps a lui retirer ce qu'elle apporte.
 *
 * Ce qu'il y a ici tient en cinquante lignes : des rectangles, une grille de
 * filets, et les couleurs de statut deja definies. Le jour ou il faudra un
 * nuage de points ou une double echelle, la question se reposera.
 *
 * Les barres sont **empilees et non cote a cote** : ce qu'on lit d'abord est la
 * hauteur totale -- combien d'executions ce jour-la -- et la part rouge se voit
 * dans la foulee. Deux barres jumelles demanderaient de comparer deux hauteurs
 * pour repondre a la meme question.
 */
export function Tendance({ jours }: { jours: JourStats[] }) {
  const { t, i18n } = useTranslation();
  const maximum = Math.max(1, ...jours.map((jour) => jour.reussies + jour.echouees + jour.autres));
  const pas = TRACE / Math.max(1, jours.length);
  const largeurBarre = Math.max(2, pas * 0.7);

  /** Ordonnee d'une valeur, marge comprise. */
  const ordonnee = (valeur: number): number => MARGE + HAUTEUR - (valeur / maximum) * HAUTEUR;

  // Trois graduations : zero, la moitie, le maximum. Davantage encombrerait un
  // dessin de cent vingt pixels de haut sans rien apprendre.
  const graduations = [...new Set([0, Math.round(maximum / 2), maximum])];

  return (
    <div className="border-line bg-surface space-y-2 border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-faint text-[11px] font-semibold tracking-wider uppercase">
          {t('pilotage.tendance')}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <Legende classe="bg-positive" libelle={t('executions.statut.succeeded')} />
          <Legende classe="bg-critical" libelle={t('executions.statut.failed')} />
          <Legende classe="bg-faint" libelle={t('pilotage.autres')} />
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${String(LARGEUR)} ${String(MARGE + HAUTEUR + 18)}`}
          className="h-40 w-full min-w-[36rem]"
          role="img"
          aria-label={t('pilotage.tendance')}
        >
          {graduations.map((valeur) => {
            const y = ordonnee(valeur);

            return (
              <g key={valeur}>
                <line
                  x1={GOUTTIERE}
                  x2={LARGEUR}
                  y1={y}
                  y2={y}
                  className="stroke-line"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={GOUTTIERE - 5}
                  y={y - 3}
                  textAnchor="end"
                  className="fill-faint text-[9px]"
                >
                  {valeur}
                </text>
              </g>
            );
          })}

          {jours.map((jour, index) => {
            const total = jour.reussies + jour.echouees + jour.autres;
            const x = GOUTTIERE + index * pas + (pas - largeurBarre) / 2;
            const hauteurDe = (compte: number): number => (compte / maximum) * HAUTEUR;

            // Empilees du bas vers le haut : reussites, puis echecs, puis le
            // reste. L'ordre est stable d'un jour a l'autre, sans quoi l'oeil
            // suivrait un damier au lieu d'une tendance.
            const hReussies = hauteurDe(jour.reussies);
            const hEchouees = hauteurDe(jour.echouees);
            const hAutres = hauteurDe(jour.autres);
            const bas = MARGE + HAUTEUR;

            return (
              <g key={jour.jour}>
                <title>
                  {`${new Date(jour.jour).toLocaleDateString(i18n.language)} — ${String(total)}`}
                </title>
                <rect
                  x={x}
                  y={bas - hReussies}
                  width={largeurBarre}
                  height={hReussies}
                  className="fill-positive"
                />
                <rect
                  x={x}
                  y={bas - hReussies - hEchouees}
                  width={largeurBarre}
                  height={hEchouees}
                  className="fill-critical"
                />
                <rect
                  x={x}
                  y={bas - hReussies - hEchouees - hAutres}
                  width={largeurBarre}
                  height={hAutres}
                  className="fill-faint"
                />
              </g>
            );
          })}

          {/* Seules les extremites sont datees : trente etiquettes se
              chevaucheraient, et l'on ne lit de toute facon qu'un ordre de
              grandeur sur une tendance. */}
          {jours.length > 0 && (
            <>
              <text x={GOUTTIERE} y={MARGE + HAUTEUR + 14} className="fill-faint text-[9px]">
                {new Date(jours[0]?.jour ?? '').toLocaleDateString(i18n.language)}
              </text>
              <text
                x={LARGEUR}
                y={MARGE + HAUTEUR + 14}
                textAnchor="end"
                className="fill-faint text-[9px]"
              >
                {new Date(jours[jours.length - 1]?.jour ?? '').toLocaleDateString(i18n.language)}
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

function Legende({ classe, libelle }: { classe: string; libelle: string }) {
  return (
    <span className="text-muted inline-flex items-center gap-1.5">
      <span aria-hidden className={`size-2 shrink-0 rounded-[1px] ${classe}`} />
      {libelle}
    </span>
  );
}
