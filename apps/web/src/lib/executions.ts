import type { Ton } from '@/components/ui/primitives';
import type { ExecutionStatus, LogLevel } from '@/lib/types';

/**
 * Couleur d'un statut d'execution.
 *
 * **Le violet n'y figure pas.** C'est la couleur de marque, reservee a ce sur
 * quoi on agit -- un bouton, un lien, l'entite active. S'en servir pour un statut
 * la banaliserait : sur une liste de quarante executions, le violet cesserait de
 * vouloir dire « ici » pour ne plus dire que « une execution ».
 *
 * `queued` et `cancelled` sont neutres, et volontairement : ni l'une ni l'autre
 * ne demande quoi que ce soit. Une file qui avance normalement ne doit pas
 * clignoter, et une execution qu'on a interrompue soi-meme n'est pas un incident.
 */
export const TON_DU_STATUT: Record<ExecutionStatus, Ton> = {
  queued: 'neutre',
  running: 'info',
  succeeded: 'positif',
  failed: 'critique',
  cancelled: 'neutre',
  // `attention` et non `critique` : rien n'est casse dans le bot, c'est
  // l'infrastructure qui a laisse tomber. Les peindre pareil ferait chercher la
  // panne dans le mauvais journal.
  abandoned: 'attention',
};

/** Couleur d'un niveau de journal. Une echelle de gravite, rien d'autre. */
export const TON_DU_NIVEAU: Record<LogLevel, Ton> = {
  debug: 'neutre',
  info: 'neutre',
  warning: 'attention',
  error: 'critique',
};

/** Les statuts dont on ne sort plus : l'interface arrete alors de relire. */
const TERMINAUX: ExecutionStatus[] = ['succeeded', 'failed', 'cancelled', 'abandoned'];

export function estTerminal(statut: ExecutionStatus): boolean {
  return TERMINAUX.includes(statut);
}

/**
 * Duree lisible.
 *
 * En secondes des qu'on depasse la seconde, en millisecondes en dessous : « 1,2 s »
 * se lit, « 1247 ms » se compte. Au-dela de la minute, le format change encore --
 * « 340 s » oblige a diviser de tete.
 */
export function dureeLisible(millisecondes: number | null): string {
  if (millisecondes === null) return '—';
  if (millisecondes < 1000) return `${String(millisecondes)} ms`;

  const secondes = millisecondes / 1000;

  if (secondes < 60) return `${secondes.toFixed(1)} s`;

  const minutes = Math.floor(secondes / 60);

  return `${String(minutes)} min ${String(Math.round(secondes % 60)).padStart(2, '0')} s`;
}

/**
 * Horodatage lisible, dans la langue et le fuseau du lecteur.
 *
 * La conversion se fait ici et non cote serveur : une installation sert des gens
 * de plusieurs fuseaux, et une date rendue deja formatee par le serveur serait
 * fausse pour tous ceux qui ne sont pas dans le sien.
 */
export function instantLisible(iso: string | null, langue: string): string {
  if (!iso) return '—';

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString(langue, { dateStyle: 'short', timeStyle: 'medium' });
}

/** Heure seule : dans un journal, la date se repete a chaque ligne pour rien. */
export function heureLisible(iso: string, langue: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return (
    date.toLocaleTimeString(langue, { hour12: false }) +
    `.${String(date.getMilliseconds()).padStart(3, '0')}`
  );
}
