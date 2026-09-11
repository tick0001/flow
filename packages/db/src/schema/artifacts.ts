import { relations } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { executions } from './executions.js';
import { artifactKindEnum } from './enums.js';

/**
 * Une piece produite par une execution : capture, trace, fichier de sortie.
 *
 * **La base garde la trace, le stockage garde le contenu.** L'outil remplace
 * gardait la capture d'echec dans une colonne `BLOB`, ce qui l'obligeait a
 * definir une vue allegee des executions pour que la moindre liste ne charge pas
 * les images -- une complication qui se propage a chaque requete, pour un
 * probleme qu'on s'etait cree.
 *
 * Ici la ligne pese quelques centaines d'octets : de quoi nommer le fichier, le
 * typer, le dimensionner et le retrouver. Une liste d'executions peut donc
 * joindre ses pieces sans precaution.
 */
export const executionArtifacts = pgTable(
  'execution_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    kind: artifactKindEnum('kind').notNull(),

    /**
     * Nom lisible, propose au telechargement.
     *
     * Pour un fichier depose par un bot, c'est le nom qu'il a choisi -- nettoye,
     * puisqu'il vient de code arbitraire ecrit par un tiers. Il ne sert jamais a
     * retrouver le fichier : la clef s'en charge.
     */
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    /**
     * Clef dans le stockage de fichiers.
     *
     * Opaque a dessein : elle n'est jamais rendue au navigateur, qui demande une
     * piece par son identifiant. Un chemin servi en statique serait devinable, et
     * contournerait le cloisonnement que tout le reste applique.
     */
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('execution_artifacts_execution_idx').on(t.executionId, t.createdAt)],
);

export const executionArtifactsRelations = relations(executionArtifacts, ({ one }) => ({
  execution: one(executions, {
    fields: [executionArtifacts.executionId],
    references: [executions.id],
  }),
}));
