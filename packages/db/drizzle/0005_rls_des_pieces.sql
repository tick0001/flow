-- =============================================================================
-- Cloisonnement des pieces d'execution, et recherche dans les journaux.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Politique des pieces
--
-- Une piece suit exactement la visibilite de son execution. Elle ne porte donc
-- ni entite ni auteur : les dupliquer aurait ouvert la possibilite qu'elles
-- divergent de l'execution dont elles parlent, pour une information deja
-- disponible a un acces d'index.
--
-- Le GRANT n'est plus necessaire : les privileges par defaut poses en 0003
-- couvrent les tables creees ensuite. C'est precisement ce pour quoi ils ont ete
-- poses -- et la premiere occasion de verifier qu'ils fonctionnent.
-- -----------------------------------------------------------------------------
ALTER TABLE execution_artifacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY execution_artifacts_scope ON execution_artifacts FOR ALL TO flow_app
  USING (
    EXISTS (
      SELECT 1
        FROM executions x
        JOIN entities e ON e.id = x.entity_id
       WHERE x.id = execution_id
         AND flow_in_scope(e.path)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM executions x
        JOIN entities e ON e.id = x.entity_id
       WHERE x.id = execution_id
         AND flow_in_scope(e.path)
    )
  );
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Recherche dans les journaux : rien a ajouter
--
-- Un second index sur `lower(message)` a failli etre pose ici, au motif que
-- l'index trigramme de 0003 n'aurait servi que `LIKE`. C'est faux : la classe
-- d'operateurs `gin_trgm_ops` sert aussi `ILIKE`, `~` et `~*`, et le plan le
-- montre -- `Bitmap Index Scan on execution_logs_message_trgm` avec
-- `Index Cond: (message ~~* '%motif%')`.
--
-- La recherche s'ecrit donc `ILIKE`, et l'index existant suffit. Le second
-- aurait double le cout d'ecriture de la table qui grossit le plus vite du
-- schema, pour rien.
-- -----------------------------------------------------------------------------
