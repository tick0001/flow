-- =============================================================================
-- Le registre des plugins : lisible par l'application, ecrit par le seul
-- proprietaire.
--
-- Un plugin s'installe et se desinstalle en creant et en supprimant un schema
-- PostgreSQL -- des ordres que le role applicatif n'a pas le droit de passer,
-- et qu'il ne doit pas avoir. Installer un plugin n'est pas une operation
-- metier : c'est une modification de l'application.
--
-- D'ou deux politiques de lecture, et aucune d'ecriture. Le Row-Level Security
-- refuse par defaut ce qu'aucune politique n'autorise : `flow_app` lit la liste
-- des plugins -- l'interface en a besoin pour savoir quels emplacements
-- remplir -- et ne peut ni l'etendre ni la vider, meme en SQL brut, meme depuis
-- un plugin.
--
-- Les privileges de table viennent des privileges par defaut poses en 0003.
-- =============================================================================

ALTER TABLE plugins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY plugins_lecture ON plugins FOR SELECT TO flow_app USING (true);
--> statement-breakpoint

ALTER TABLE plugin_migrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY plugin_migrations_lecture ON plugin_migrations FOR SELECT TO flow_app USING (true);
