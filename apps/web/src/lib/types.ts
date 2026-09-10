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
  EntityRef,
  ProfileDetail,
  ProfileRef,
  ProfileRight,
  RightDefinition,
  RightScope,
  SessionContext,
  UserSummary,
} from '@flow/contracts';
