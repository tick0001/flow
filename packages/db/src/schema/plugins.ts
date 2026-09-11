import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Un plugin installe.
 *
 * **Global a l'installation, et non porte par une entite.** Un plugin ajoute des
 * tables, des droits et des points d'accroche au coeur : il n'a pas de sens
 * « pour la filiale nord seulement ». Ce qu'il produit, lui, est cloisonne comme
 * le reste -- ses tables portent une entite et ses politiques appellent
 * `flow_in_scope`, exactement comme celles du coeur.
 *
 * La ligne est la trace de l'installation, pas de la presence sur le disque. Les
 * deux se separent : un dossier depose et jamais installe n'a pas de ligne, et
 * une ligne dont le dossier a disparu decrit un **orphelin** -- dont le schema et
 * les droits sont pourtant toujours la. C'est cet ecart qui rend la
 * desinstallation possible apres coup.
 */
export const plugins = pgTable('plugins', {
  /** L'identifiant du manifeste. Jamais reattribue. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Version installee, qui peut differer de celle posee sur le disque. */
  version: text('version').notNull(),

  /**
   * Le schema PostgreSQL cree pour lui, ou `null` s'il n'en a pas demande.
   *
   * Stocke plutot que recalcule : c'est ce qu'il faut supprimer, et le deduire
   * de l'identifiant au moment de la desinstallation supposerait que la regle
   * n'a jamais change depuis l'installation.
   */
  schemaName: text('schema_name'),

  /**
   * Actif ou en sommeil.
   *
   * Desactiver n'est pas desinstaller : les tables et les droits restent, et
   * seuls les hooks, les evenements, les taches et les emplacements cessent.
   * C'est ce qu'on veut quand un plugin se met a refuser tous les lancements un
   * lundi matin -- couper sans rien perdre, et regarder ensuite.
   */
  isEnabled: boolean('is_enabled').notNull().default(true),

  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Les migrations d'un plugin deja jouees.
 *
 * Le plugin depose des fichiers SQL dans `migrations/` ; ils sont joues dans
 * l'ordre de leurs noms, une seule fois, et le nom joue est inscrit ici. Une
 * montee de version rejoue donc seulement ce qui est nouveau.
 *
 * La cle primaire est le couple : deux plugins peuvent tres bien nommer leur
 * premiere migration `0000_initial.sql`.
 */
export const pluginMigrations = pgTable(
  'plugin_migrations',
  {
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.pluginId, table.filename] })],
);
