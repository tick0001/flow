-- =============================================================================
-- Cloisonnement des executions et de leurs journaux.
--
-- Les tables du jalon J3 rejoignent le dispositif pose en 0001 : le role
-- applicatif -- celui de l'API **comme celui du worker** -- ne voit que le
-- perimetre d'entites de sa transaction. Le worker n'y echappe pas, alors qu'il
-- aurait pu ecrire avec le role proprietaire : cela aurait prive les journaux et
-- les resultats du seul cloisonnement que tout le reste respecte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Droits sur les tables neuves
--
-- Le GRANT de 0001 portait sur « toutes les tables » telles qu'elles existaient
-- alors : une table creee apres lui n'est accessible a personne d'autre que son
-- proprietaire. L'oubli ne se voit pas a la migration -- elle passe -- mais a la
-- premiere requete applicative, sur un « permission denied » qui ne dit pas
-- quelle migration l'a cause.
--
-- D'ou les privileges par defaut, poses une fois pour toutes : les tables des
-- migrations suivantes, et celles que les plugins apporteront, seront couvertes
-- sans que personne ait a y penser. `current_user` plutot qu'un nom ecrit en
-- dur : le role proprietaire s'appelle `flow` sur un poste, autre chose sur une
-- installation reelle.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON executions, execution_logs TO flow_app;
--> statement-breakpoint

DO $privileges$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flow_app',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO flow_app',
    current_user
  );
END;
$privileges$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Politiques
--
-- La forme est celle de `entity_settings` et `authorizations` : un EXISTS sur
-- `entities`, et non une copie du chemin sur l'objet.
--
-- La fonction `sync_entity_path()` posee en 0001 avait ete ecrite pour ces
-- tables-ci, et elle est supprimee plus bas : elle copiait le chemin de l'entite
-- sur l'objet a l'ecriture, et **rien ne l'aurait propagee** le jour ou une
-- entite change de parent. Les executions d'une branche deplacee seraient alors
-- restees visibles depuis son ancien emplacement et invisibles depuis le
-- nouveau -- une fuite silencieuse, dans le sens le plus desagreable : celui qui
-- ne casse rien.
--
-- Le prix de la jointure est un acces d'index sur `entities`, une table de
-- quelques milliers de lignes au plus, entierement en cache. Le prix de la copie
-- aurait ete un declencheur de propagation sur `entities` pour chaque table
-- rattachee, a n'oublier dans aucune migration ni aucun plugin.
-- -----------------------------------------------------------------------------
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY executions_scope ON executions FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
--> statement-breakpoint

-- Une ligne de journal suit exactement la visibilite de son execution.
--
-- Elle ne porte donc ni entite ni auteur : les dupliquer sur la table qui
-- grossit le plus vite du schema aurait ajoute deux colonnes par ligne pour une
-- information deja disponible, et ouvert la possibilite qu'elles divergent de
-- l'execution dont elles parlent.
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY execution_logs_scope ON execution_logs FOR ALL TO flow_app
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
-- 3. Recherche dans les journaux
--
-- Un index trigramme plutot qu'un `tsvector` : on cherche un fragment de
-- message d'erreur -- un identifiant, un selecteur CSS, un morceau de trace --
-- et non un mot de la langue. La recherche plein texte aurait racine-ise
-- « ETIMEDOUT » et decoupe « #form > input[name] » en mots, ce qui est
-- exactement ce qu'il ne faut pas ici.
--
-- L'ecran de recherche arrive au jalon J5 ; l'index est pose avec la table
-- parce que le creer plus tard demanderait de le batir sur des millions de
-- lignes deja ecrites.
-- -----------------------------------------------------------------------------
CREATE INDEX execution_logs_message_trgm ON execution_logs USING gin (message gin_trgm_ops);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Retrait de `sync_entity_path()`
--
-- Posee en 0001 « pour que les executions et les planifications la prennent
-- telle quelle ». Elles ne la prennent pas : voir la raison au point 2. La
-- laisser en place serait laisser une fonction que le prochain a ecrire une
-- table rattachee cablerait de bonne foi, en heritant du defaut.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS sync_entity_path();
