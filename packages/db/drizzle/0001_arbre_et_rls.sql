-- =============================================================================
-- Coherence de l'arbre des entites, et isolation par Row-Level Security.
--
-- Ce fichier porte les garanties que le schema seul ne peut pas exprimer : les
-- chemins ltree restent exacts quoi qu'il arrive, et aucune requete du role
-- applicatif ne peut sortir du perimetre d'entites de la transaction courante.
--
-- Le filtrage applicatif reste la premiere ligne : explicite, testable, et il
-- produit des requetes efficaces. Ceci est la seconde ligne, celle qui garantit
-- qu'un oubli dans un service -- ou une requete brute ecrite par un plugin --
-- **ne peut pas** faire fuiter des donnees entre organisations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chemins de l'arbre des entites
--
-- Le chemin est bati a partir des identifiants (`e12.e37`) et non des noms : il
-- reste ainsi stable a travers les renommages et ne peut pas entrer en
-- collision. La valeur identite est deja disponible dans un declencheur
-- BEFORE INSERT, ce qui permet de la composer des l'ecriture.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION entities_compute_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_path     ltree;
  parent_level    integer;
  parent_complete text;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path          := ('e' || NEW.id)::ltree;
    NEW.level         := 0;
    NEW.complete_name := NEW.name;
  ELSE
    SELECT path, level, complete_name
      INTO parent_path, parent_level, parent_complete
      FROM entities
     WHERE id = NEW.parent_id;

    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Entite parente % introuvable', NEW.parent_id;
    END IF;

    -- Un deplacement sous sa propre descendance detacherait le sous-arbre du
    -- reste de l'arbre : il deviendrait invisible sans qu'aucune erreur ne soit
    -- levee, et les objets rattaches avec lui.
    IF TG_OP = 'UPDATE' AND parent_path <@ OLD.path THEN
      RAISE EXCEPTION 'Deplacement invalide : une entite ne peut pas devenir sa propre descendante';
    END IF;

    NEW.path          := parent_path || ('e' || NEW.id)::ltree;
    NEW.level         := parent_level + 1;
    NEW.complete_name := parent_complete || ' > ' || NEW.name;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

-- Propagation aux descendants.
--
-- La mise a jour se fait enfant par enfant plutot que par un UPDATE global :
-- chaque enfant repasse par le declencheur ci-dessus, qui recalcule son chemin
-- depuis son parent deja mis a jour, puis propage a son tour. La recursion
-- s'arrete d'elle-meme des qu'un niveau ne change plus.
CREATE OR REPLACE FUNCTION entities_propagate_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.complete_name IS DISTINCT FROM OLD.complete_name THEN
    UPDATE entities SET parent_id = parent_id WHERE parent_id = NEW.id;
  END IF;

  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

-- Le declencheur s'execute avec les droits de l'appelant, donc **sous** les
-- politiques : son `SELECT ... FROM entities` ne voit que le perimetre courant.
--
-- Consequence a connaitre : inserer sous un parent hors perimetre echoue sur
-- « Entite parente % introuvable » et non sur une violation de politique. C'est
-- le bon comportement -- un message distinguant « invisible » de « inexistante »
-- confirmerait l'existence d'une entite d'une autre organisation -- mais c'est
-- deroutant en diagnostic, et cela vaut d'etre su avant de chercher ailleurs.
CREATE TRIGGER entities_compute_path_trg
  BEFORE INSERT OR UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_compute_path();
--> statement-breakpoint

CREATE TRIGGER entities_propagate_path_trg
  AFTER UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_propagate_path();
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Denormalisation du chemin sur les objets rattaches a une entite
--
-- Les politiques comparent un chemin a un autre. Sans une colonne `entity_path`
-- portee par l'objet lui-meme, chaque verification declencherait une
-- sous-requete sur `entities` et l'index GIST deviendrait inutilisable.
--
-- La fonction est posee des maintenant, alors qu'aucune table du jalon J1 ne
-- l'utilise : les executions et les planifications la prendront telle quelle.
-- La declarer ici plutot qu'a leur arrivee evite d'en avoir deux variantes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_entity_path() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  SELECT path INTO NEW.entity_path FROM entities WHERE id = NEW.entity_id;

  IF NEW.entity_path IS NULL THEN
    RAISE EXCEPTION 'Entite % introuvable', NEW.entity_id;
  END IF;

  RETURN NEW;
END;
$fn$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3. Lecture du contexte de la transaction
--
-- Les parametres sont poses par `set_config(..., true)` a l'ouverture de chaque
-- transaction applicative. Le second argument `true` de `current_setting` evite
-- l'erreur lorsque le parametre est absent : une connexion sans contexte voit
-- alors un perimetre **vide**, jamais un perimetre total. C'est l'invariant le
-- plus important du dispositif -- le defaut penche du cote du refus.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION flow_entity_path() RETURNS ltree
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('flow.entity_path', true), '')::ltree
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION flow_scope_paths() RETURNS ltree[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('flow.scope_paths', true), '')::ltree[], '{}'::ltree[])
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION flow_exact_paths() RETURNS ltree[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('flow.exact_paths', true), '')::ltree[], '{}'::ltree[])
$fn$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION flow_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('flow.user_id', true), '')::bigint
$fn$;
--> statement-breakpoint

-- Visibilite descendante : l'objet appartient au perimetre habilite.
--
-- Deux tableaux et non un : `flow_scope_paths()` porte les habilitations
-- recursives, dont toute la descendance est visible, et `flow_exact_paths()`
-- les habilitations simples, ou seule l'entite elle-meme l'est. Les fondre
-- obligerait a choisir un comportement unique pour les deux.
CREATE OR REPLACE FUNCTION flow_in_scope(target ltree) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT target <@ flow_scope_paths() OR target = ANY (flow_exact_paths())
$fn$;
--> statement-breakpoint

-- Visibilite de configuration : le perimetre habilite, plus ce qu'un ancetre
-- partage explicitement vers le bas par son drapeau recursif.
--
-- Couvre deux besoins qu'il serait tentant de confondre : **l'administration**
-- (quels objets existent dans mon perimetre) par le premier terme, et **l'usage**
-- (lesquels puis-je choisir depuis l'entite active) par le second.
CREATE OR REPLACE FUNCTION flow_config_visible(target ltree, recursive_flag boolean)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT flow_in_scope(target)
      OR (recursive_flag AND target @> flow_entity_path())
$fn$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Politiques
--
-- Le role proprietaire n'est pas soumis aux politiques : migrations et amorcage
-- passent par lui. Tout le trafic applicatif passe par `flow_app`.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flow_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flow_app;
--> statement-breakpoint

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY entities_scope ON entities FOR ALL TO flow_app
  USING (flow_in_scope(path))
  WITH CHECK (flow_in_scope(path));
--> statement-breakpoint

ALTER TABLE entity_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY entity_settings_scope ON entity_settings FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
--> statement-breakpoint

-- Les habilitations ne sont lisibles que dans le perimetre.
ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY authorizations_scope ON authorizations FOR ALL TO flow_app
  USING (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)))
  WITH CHECK (EXISTS (SELECT 1 FROM entities e WHERE e.id = entity_id AND flow_in_scope(e.path)));
--> statement-breakpoint

-- Une session n'appartient qu'a son porteur.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_own ON sessions FOR ALL TO flow_app
  USING (user_id = flow_user_id())
  WITH CHECK (user_id = flow_user_id());
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 5. Ce que le Row-Level Security ne couvre pas, et pourquoi
--
-- `users`, `profiles` et `profile_rights` n'ont **pas** de politique, et c'est
-- delibere : ce sont des referentiels globaux a l'installation, sans colonne
-- d'entite. Un compte existe une fois, quelles que soient les branches ou il est
-- habilite ; un profil est un jeu de droits nomme, partage.
--
-- Ce sont donc les services qui decident ce qu'un administrateur d'une branche
-- voit de la liste des comptes -- en la restreignant a ceux qui ont une
-- habilitation dans son perimetre, ce qui est une jointure sur `authorizations`,
-- elle-meme protegee par sa politique.
--
-- Poser une politique ici aurait demande de denormaliser une entite sur le
-- compte, c'est-a-dire de lui en choisir une principale : la question n'a pas de
-- reponse pour quelqu'un habilite sur deux branches.
-- -----------------------------------------------------------------------------
