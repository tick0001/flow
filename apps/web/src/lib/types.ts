import type {
  ExecutionDetail as ExecutionDetailServeur,
  ExecutionLog as ExecutionLogServeur,
  ExecutionSummary as ExecutionSummaryServeur,
  UserSummary as UserSummaryServeur,
} from '@flow/contracts';

/**
 * Types du client, deduits des contrats partages.
 *
 * Reexportes ici pour que les composants n'importent pas `@flow/contracts`
 * directement : le jour ou une forme devra differer cote interface -- une date
 * deja convertie, un champ calcule --, l'adaptation se fera a cet endroit et
 * nulle part ailleurs.
 */
export type {
  Authorization,
  AvailableContext,
  BotManifest,
  BotSummary,
  EntityRef,
  ExecutionStatus,
  LogLevel,
  ProfileDetail,
  ProfileRef,
  ProfileRight,
  RightDefinition,
  RightScope,
  SessionContext,
} from '@flow/contracts';

/**
 * Ce qu'une reponse HTTP rend reellement.
 *
 * Les contrats decrivent les dates en `Date`, ce qui est juste cote serveur : la
 * base en rend, et un schema Zod en produit. Mais **rien de tout cela ne survit a
 * JSON** -- une date arrive ici en chaine ISO, pendant que le type promet une
 * `Date`. Appeler `toLocaleString()` dessus ne leve pas : `String.prototype` en a
 * une, et elle rend la chaine telle quelle. La date s'afficherait donc en
 * `2026-09-11T09:48:54.047Z` au milieu d'une interface francaise, sans qu'aucune
 * erreur ne le signale.
 *
 * Cette transformation dit la verite : recursive, elle traverse les objets
 * imbriques et les tableaux, et se distribue sur les unions -- `Date | null`
 * devient `string | null`.
 */
type Transporte<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Transporte<U>[]
    : T extends object
      ? { [K in keyof T]: Transporte<T[K]> }
      : T;

export type ExecutionSummary = Transporte<ExecutionSummaryServeur>;
export type ExecutionDetail = Transporte<ExecutionDetailServeur>;
export type ExecutionLog = Transporte<ExecutionLogServeur>;
export type UserSummary = Transporte<UserSummaryServeur>;

/** Une page de resultats, telle que les listes paginees la rendent. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
