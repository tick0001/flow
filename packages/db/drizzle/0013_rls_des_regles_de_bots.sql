-- =============================================================================
-- Cloisonnement des regles de mise a disposition des bots.
--
-- Une regle porte une entite : sa politique est donc celle des regles
-- d'annuaire, par une jointure sur `entities`. L'administrateur d'une branche
-- voit et pose les regles de sa branche, et rien d'autre.
--
-- Le cloisonnement compte ici autant que pour les regles d'annuaire, et pour la
-- meme raison : une regle de bot decide **quel code s'executera chez qui**. Sans
-- politique, l'administrateur d'une filiale pourrait ouvrir sur le siege un bot
-- qui s'authentifie avec les identifiants du siege -- et la trace ne montrerait
-- qu'une execution ordinaire, lancee par quelqu'un du siege.
--
-- Les privileges de table viennent des privileges par defaut poses en 0003.
-- =============================================================================

ALTER TABLE bot_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY bot_rules_scope ON bot_rules FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
--> statement-breakpoint

-- Unicite des regles « tous profils ».
--
-- L'index genere par Drizzle porte sur (bot_id, entity_id, profile_id), et
-- PostgreSQL tient deux NULL pour differents : il laisse donc passer autant de
-- regles « tous profils » qu'on en pose sur le meme couple. Elles ne diraient
-- rien de plus, et supprimer l'une laisserait l'autre ouvrir le bot -- un retrait
-- sans effet, ce qui est la pire facon de rater un retrait de droit.
--
-- `NULLS NOT DISTINCT` aurait suffi depuis PostgreSQL 15 ; l'index partiel dit
-- la meme chose et ne depend pas de la version de l'ORM.
CREATE UNIQUE INDEX bot_rules_unique_tous_profils
  ON bot_rules (bot_id, entity_id)
  WHERE profile_id IS NULL;
