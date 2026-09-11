-- =============================================================================
-- Cloisonnement des planifications et des clefs d'API.
--
-- Les deux portent une entite : leur politique est donc celle des executions,
-- directe, et non celle des journaux qui passe par leur execution. Les
-- privileges viennent des privileges par defaut poses en 0003 -- c'est la
-- deuxieme migration qui n'a plus besoin d'ecrire un GRANT.
-- =============================================================================

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedules_scope ON schedules FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
--> statement-breakpoint

-- Une clef d'API est visible dans le perimetre de son entite.
--
-- Elle n'est **pas** reservee a son proprietaire : un administrateur doit voir
-- les clefs vivantes de son perimetre, sans quoi personne ne pourrait revoquer
-- celle d'une personne partie. Le resserrement a « les siennes » est l'affaire
-- de la portee du droit, pas de la politique -- la politique dit ce qui existe
-- pour cette branche, la portee dit ce que ce profil-la en fait.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_keys_scope ON api_keys FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
