import type { SVGProps } from 'react';

/**
 * Jeu d'icônes minimal.
 *
 * Écrit ici plutôt qu'importé : une bibliothèque d'icônes embarque plusieurs
 * milliers de tracés pour la vingtaine dont cette interface a besoin, et impose
 * son propre rythme de mise à jour. Le style est uniforme — trait de 1,5,
 * extrémités arrondies, grille de 24 — parce que c'est ce qui fait qu'un jeu
 * d'icônes tient ensemble, bien plus que le nombre de tracés.
 *
 * Les tracés que Flow& partage avec Tick& — planning, statistiques, entités,
 * comptes, droits, annuaire, réglages, thème, menu — sont **les mêmes tracés**,
 * au caractère près. Deux outils de la même collection qui dessineraient
 * différemment la même idée se liraient comme deux produits sans rapport.
 */
function Trace(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export type Icone = (props: SVGProps<SVGSVGElement>) => React.ReactElement;

/* --- Propres à Flow& ------------------------------------------------------ */

/**
 * Un bot : la fenêtre d'un navigateur, et ce qui la pilote.
 *
 * Pas une tête de robot. Ce que Flow& exécute n'est pas un personnage, c'est un
 * script qui conduit un navigateur — et l'icône la plus répétée de l'interface
 * a intérêt à dire ce que la chose est.
 */
export const IconBot: Icone = (props) => (
  <Trace {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 8h18" />
    <path d="M6 6h.01M8.5 6h.01" />
    <path d="m10 12 2.5 2.5L10 17M14 17h3.5" />
  </Trace>
);

/** Une exécution : le triangle de lancement, sur le cadran du temps passé. */
export const IconExecution: Icone = (props) => (
  <Trace {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m10 8.5 6 3.5-6 3.5Z" />
  </Trace>
);

/** Une clé d'API : ce qui ouvre sans qu'une personne soit devant. */
export const IconClef: Icone = (props) => (
  <Trace {...props}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2.5 2.5" />
  </Trace>
);

/**
 * Un plugin : la pièce qui s'ajoute, avec ses deux tenons.
 *
 * Le même objet que dans Tick& — le produit qui l'accueille change, pas l'idée.
 */
export const IconPlugin: Icone = (props) => (
  <Trace {...props}>
    <path d="M9 4.5a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h1.5a2 2 0 1 1 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h4Z" />
  </Trace>
);

/* --- Communes à la collection --------------------------------------------- */

export const IconPlanning: Icone = (props) => (
  <Trace {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Trace>
);

export const IconStatistiques: Icone = (props) => (
  <Trace {...props}>
    <path d="M3 21h18" />
    <path d="M6 21V11M11 21V4M16 21v-6M21 21v-9" />
  </Trace>
);

export const IconEntites: Icone = (props) => (
  <Trace {...props}>
    <path d="M3 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" />
    <path d="M13 10h6a2 2 0 0 1 2 2v9M2 21h20" />
    <path d="M6.5 8h3M6.5 12h3M6.5 16h3M16.5 14h1.5M16.5 17.5h1.5" />
  </Trace>
);

export const IconUtilisateurs: Icone = (props) => (
  <Trace {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.5 5.3a3.5 3.5 0 0 1 0 5.4M18 14.2a6 6 0 0 1 3 5.8" />
  </Trace>
);

export const IconDroits: Icone = (props) => (
  <Trace {...props}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3 8.2 7.5 9.5 4.5-1.3 7.5-5.1 7.5-9.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Trace>
);

export const IconAnnuaire: Icone = (props) => (
  <Trace {...props}>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
    <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
  </Trace>
);

export const IconReglages: Icone = (props) => (
  <Trace {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Trace>
);

export const IconSoleil: Icone = (props) => (
  <Trace {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Trace>
);

export const IconLune: Icone = (props) => (
  <Trace {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Trace>
);

export const IconEcran: Icone = (props) => (
  <Trace {...props}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8.5 21h7M12 17v4" />
  </Trace>
);

export const IconMenu: Icone = (props) => (
  <Trace {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Trace>
);

export const IconFermer: Icone = (props) => (
  <Trace {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Trace>
);

export const IconSortie: Icone = (props) => (
  <Trace {...props}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8.5 6.5 12 10 15.5M6.5 12H15" />
  </Trace>
);

export const IconRetour: Icone = (props) => (
  <Trace {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Trace>
);

export const IconPlus: Icone = (props) => (
  <Trace {...props}>
    <path d="M12 5v14M5 12h14" />
  </Trace>
);

export const IconRecherche: Icone = (props) => (
  <Trace {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Trace>
);
