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
-- 2. Recherche dans les journaux, insensible a la casse
--
-- L'index trigramme pose en 0003 sert `LIKE '%motif%'`. Il ne sert **pas**
-- `ILIKE`, qui compare autrement : PostgreSQL ne s'en sert que si l'expression
-- indexee correspond, et `lower(message)` n'est pas `message`.
--
-- D'ou un second index sur la forme en minuscules, et une recherche ecrite
-- `lower(message) LIKE lower(motif)`. Sans lui, chercher un fragment dans les
-- journaux d'une installation qui tourne depuis un an balaierait la plus grosse
-- table du schema -- et ce serait le jour d'un incident.
-- -----------------------------------------------------------------------------
CREATE INDEX execution_logs_message_ci_trgm
  ON execution_logs USING gin (lower(message) gin_trgm_ops);
