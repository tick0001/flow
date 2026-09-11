-- =============================================================================
-- Cloisonnement des regles d'affectation.
--
-- Une regle porte une entite : sa politique est donc celle des executions et des
-- planifications, par une jointure sur `entities`. Un administrateur de branche
-- voit et pose les regles de sa branche, et rien d'autre.
--
-- Ce cloisonnement n'est pas cosmetique. Une regle est une **elevation de
-- privileges differee** : elle dit qu'un groupe d'annuaire recevra un profil sur
-- une entite, et elle s'appliquera a la prochaine connexion de quelqu'un qu'on
-- ne connait pas encore. Sans politique, l'administrateur d'une filiale pourrait
-- s'accorder l'administration du siege en creant une regle sur un groupe dont il
-- fait partie -- et rien, dans aucun journal, ne se lirait comme une intrusion.
--
-- Les privileges de table viennent des privileges par defaut poses en 0003.
-- =============================================================================

ALTER TABLE directory_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY directory_rules_scope ON directory_rules FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
