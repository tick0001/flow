import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Briques d'interface communes.
 *
 * Elles existent pour une raison précise, vérifiée dans le code que Flow&
 * remplace : la même chaîne de douze classes y était recopiée dans chaque écran,
 * si bien qu'une retouche de style se terminait toujours par deux pages qui ne se
 * ressemblaient plus, et que la variante sombre s'oubliait quelque part.
 *
 * Ici la décision est prise une fois. Les classes sont **aussi** exportées comme
 * chaînes : quelques formulaires composent leurs contrôles dans des boucles
 * denses, et leur imposer un composant ajouterait une enveloppe sans rien
 * gagner — ils partagent au moins les mêmes classes.
 */

// --- Boutons -----------------------------------------------------------------

type Variante = 'primaire' | 'secondaire' | 'discret' | 'danger';
type Taille = 'sm' | 'md';

const VARIANTES: Record<Variante, string> = {
  primaire: 'bg-brand text-on-brand hover:bg-brand-hover shadow-card',
  secondaire: 'border border-line bg-surface text-ink hover:bg-sunken',
  discret: 'text-muted hover:bg-sunken hover:text-ink',
  danger: 'border border-critical/30 bg-critical-soft text-critical-ink hover:border-critical/60',
};

const TAILLES: Record<Taille, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
};

const SOCLE =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';

export const BOUTON = cn(SOCLE, VARIANTES.secondaire, TAILLES.md);
export const BOUTON_PRIMAIRE = cn(SOCLE, VARIANTES.primaire, TAILLES.md);
export const BOUTON_DANGER = cn(SOCLE, VARIANTES.danger, TAILLES.sm);
export const BOUTON_SM = cn(SOCLE, VARIANTES.secondaire, TAILLES.sm);

/** Carte, en classes : quelques listes composent leurs cartes dans une boucle. */
export const CARTE = 'rounded-card border border-line bg-surface p-4 shadow-card';

export function Button({
  variante = 'secondaire',
  taille = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; taille?: Taille }) {
  return (
    <button
      type="button"
      className={cn(SOCLE, VARIANTES[variante], TAILLES[taille], className)}
      {...props}
    />
  );
}

/** Même apparence qu'un bouton, pour ce qui est réellement un lien. */
export function LinkButton({
  variante = 'secondaire',
  taille = 'md',
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variante?: Variante; taille?: Taille }) {
  return <a className={cn(SOCLE, VARIANTES[variante], TAILLES[taille], className)} {...props} />;
}

// --- La marque ---------------------------------------------------------------

/**
 * L'esperluette du nom.
 *
 * « Flow& » porte déjà son signe distinctif dans son nom, et c'est ce que la
 * collection a en commun. Un « F » dans un carré arrondi est le monogramme que
 * produit n'importe quel générateur ; l'esperluette se reconnaît à la taille d'un
 * favicon et rattache l'outil à sa famille.
 *
 * Le carré est presque droit et l'aplat plein : c'est le seul endroit de
 * l'interface où le violet occupe une surface, ce qui en fait un point d'ancrage
 * plutôt qu'une décoration de plus.
 */
export function Marque({ taille = 'sm' }: { taille?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-brand text-on-brand grid shrink-0 place-items-center rounded-[3px] font-bold',
        taille === 'lg' ? 'size-11 text-2xl' : 'size-7 text-base',
      )}
    >
      &amp;
    </span>
  );
}

// --- Saisie ------------------------------------------------------------------

/**
 * Socle commun des contrôles de saisie.
 *
 * Un rectangle franc, pas une pilule. Le champ est une **zone à remplir** sur un
 * formulaire : il se pose sur le papier, cerné d'un filet, et le filet
 * s'assombrit quand on écrit dedans.
 *
 * Le focus ne colore pas la bordure : l'anneau violet posé sur le document s'en
 * charge déjà. Doubler le signal en ferait deux, dont aucun ne porte.
 */
export const CONTROLE =
  'h-9 w-full rounded-[2px] border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-ink disabled:bg-sunken disabled:opacity-70';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROLE, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROLE, 'h-auto py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROLE, 'pr-8', className)} {...props} />;
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input
        type="checkbox"
        className="border-line-strong accent-brand size-4 shrink-0 rounded-[2px]"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Étiquette et contrôle, avec l'espacement décidé une fois pour toutes.
 *
 * L'étiquette est en petites capitales : sur un formulaire dense, elle se
 * distingue alors de la valeur saisie sans qu'on ait à la mettre en gras ni à la
 * grossir. C'est la convention des bordereaux et des plans — elle nomme la case
 * sans se disputer la lecture avec ce qu'on y écrit.
 */
export function Field({
  label,
  hint,
  className,
  groupe = false,
  children,
}: {
  label: string;
  hint?: string | undefined;
  className?: string | undefined;
  /**
   * Le champ porte plusieurs contrôles, et non un seul.
   *
   * Un `<label>` s'associe à **un** contrôle : celui qu'il enveloppe, ou le
   * premier s'il en enveloppe plusieurs. Un groupe de cases logées dans un
   * `<label>` produit donc des étiquettes imbriquées — ce que la norme interdit —
   * et, à l'usage, un clic sur la troisième case qui bascule aussi la première.
   * Le groupe se déclare en `<fieldset>`, dont c'est le rôle.
   */
  groupe?: boolean;
  children: ReactNode;
}) {
  const intitule = (
    <span className="text-faint block text-[11px] font-semibold tracking-wider uppercase">
      {label}
    </span>
  );

  const aide = hint ? <span className="text-faint block text-xs">{hint}</span> : null;

  if (groupe) {
    return (
      <fieldset className={cn('block space-y-1', className)}>
        <legend>{intitule}</legend>
        {children}
        {aide}
      </fieldset>
    );
  }

  return (
    <label className={cn('block space-y-1', className)}>
      {intitule}
      {children}
      {aide}
    </label>
  );
}

// --- Surfaces ----------------------------------------------------------------

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border-line bg-surface shadow-card border', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <h3 className="text-ink text-sm font-semibold">{title}</h3>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/**
 * En-tête de page.
 *
 * Le filet d'encre sous le titre n'est pas un ornement : c'est ce qui donne son
 * assise à la page. Sans lui, le trio « titre, phrase grise, bouton » flotte au
 * milieu du vide — la composition que produit toute bibliothèque, et qui ne dit
 * jamais où la page commence.
 *
 * L'intention passe **sous** le filet, avec le contenu : elle appartient à ce
 * qu'on lit, pas à l'en-tête, et la garder au-dessus l'aurait mise sur le même
 * plan que le titre, qu'elle n'a pas à concurrencer.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <div className="border-ink flex flex-wrap items-center justify-between gap-4 border-b-2 pb-3">
        <h2 className="text-ink text-xl font-bold tracking-tight">{title}</h2>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {description && <p className="text-muted max-w-2xl text-sm">{description}</p>}
    </header>
  );
}

/**
 * Titre de section, prolongé d'un filet jusqu'au bord.
 *
 * C'est le rythme vertical d'un document technique : l'œil trouve les sections en
 * balayant les filets, sans lire les libellés. Un petit gras nu, lui, se confond
 * avec le contenu dès que la page s'allonge.
 */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-muted text-xs font-semibold tracking-wider whitespace-nowrap uppercase">
        {children}
      </h3>
      <span aria-hidden className="bg-line h-px flex-1" />
      {action}
    </div>
  );
}

// --- Signalement -------------------------------------------------------------

export type Ton = 'neutre' | 'positif' | 'attention' | 'critique' | 'info' | 'marque';

const TONS: Record<Ton, string> = {
  neutre: 'bg-sunken text-muted border-line',
  positif: 'bg-positive-soft text-positive-ink border-positive/30',
  attention: 'bg-caution-soft text-caution-ink border-caution/30',
  critique: 'bg-critical-soft text-critical-ink border-critical/30',
  info: 'bg-info-soft text-info-ink border-info/30',
  marque: 'bg-brand-soft text-brand-ink border-brand/30',
};

const POINTS: Record<Ton, string> = {
  neutre: 'bg-faint',
  positif: 'bg-positive',
  attention: 'bg-caution',
  critique: 'bg-critical',
  info: 'bg-info',
  marque: 'bg-brand',
};

/**
 * Étiquette d'appoint : une version, un compteur, une catégorie.
 *
 * Distincte de la pastille, et la distinction compte : l'étiquette qualifie, la
 * pastille dit un **état**. Les confondre reviendrait à donner le même poids à
 * « v1.2.0 » et à « en échec ».
 */
export function Badge({
  ton = 'neutre',
  className,
  children,
}: {
  ton?: Ton;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[2px] border px-1.5 py-0.5 text-[11px] font-medium',
        TONS[ton],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * État d'une exécution : un point coloré et un mot, jamais un aplat plein.
 *
 * Sur une liste de quarante exécutions, quarante aplats colorés se neutralisent —
 * l'écran devient un damier et plus rien ne ressort. Le point porte la couleur,
 * le mot porte le sens, et le fond reste du papier.
 */
export function Pastille({ ton = 'neutre', children }: { ton?: Ton; children: ReactNode }) {
  return (
    <span className="text-ink inline-flex items-center gap-1.5 text-xs font-medium">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', POINTS[ton])} />
      {children}
    </span>
  );
}

/**
 * Message d'information ou d'alerte, posé dans le flux.
 *
 * Cerné d'un filet et non d'une ombre, comme tout le reste : c'est un encadré de
 * document, pas une notification qui flotte.
 */
export function Notice({
  ton = 'info',
  className,
  children,
}: {
  ton?: Ton;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-[2px] border px-3 py-2 text-sm', TONS[ton], className)}>
      {children}
    </div>
  );
}

/**
 * Liste vide.
 *
 * Dit **pourquoi** c'est vide et ce qu'on peut y faire. « Aucun résultat » seul
 * laisse le lecteur se demander s'il a mal filtré ou si l'outil est cassé.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-line bg-sunken flex flex-col items-center gap-2 border border-dashed px-6 py-12 text-center">
      <p className="text-ink text-sm font-semibold">{title}</p>
      {description && <p className="text-muted max-w-md text-sm">{description}</p>}
      {action}
    </div>
  );
}

/**
 * Enveloppe de tableau.
 *
 * Le défilement horizontal appartient au tableau, jamais à la page : un écran
 * dont le corps entier glisse latéralement fait disparaître la navigation, et on
 * ne sait plus où l'on est.
 */
export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('border-line bg-surface overflow-x-auto border', className)}>{children}</div>
  );
}
