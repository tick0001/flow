-- Les tables du carnet.
--
-- Le chemin de recherche pointe deja sur le schema du plugin : ces tables
-- naissent dans « plugin_exemple_carnet », et un plugin ne peut pas semer une
-- table dans « public » par megarde.
--
-- Les types et les fonctions du coeur restent accessibles par « public », d'ou
-- « public.ltree » et « public.flow_in_scope » ecrits en toutes lettres : le
-- schema du plugin passe avant dans le chemin, et un homonyme y prendrait
-- silencieusement la place.

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid,
  -- Le chemin de l'entite, et non son identifiant : c'est ce que la fonction de
  -- cloisonnement prend, et cela evite une jointure dans chaque politique.
  entity_path public.ltree NOT NULL,
  texte text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_execution_idx ON notes (execution_id, created_at DESC);

-- Les bots qu'une branche a mis au gel, et le motif.
CREATE TABLE bots_geles (
  bot_id text NOT NULL,
  entity_path public.ltree NOT NULL,
  motif text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, entity_path)
);

-- Le cloisonnement d'un plugin est **celui du coeur**, par la meme fonction.
--
-- C'est le point le plus important de ce plugin d'exemple : une extension
-- n'invente pas son isolation et n'a pas a la reimplementer en clauses WHERE.
-- Elle declare une politique, et la filiale nord ne voit pas les notes du
-- siege -- meme si le plugin oublie de filtrer, meme en SQL brut.
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_scope ON notes FOR ALL TO flow_app
  USING (public.flow_in_scope(entity_path))
  WITH CHECK (public.flow_in_scope(entity_path));

ALTER TABLE bots_geles ENABLE ROW LEVEL SECURITY;

CREATE POLICY bots_geles_scope ON bots_geles FOR ALL TO flow_app
  USING (public.flow_in_scope(entity_path))
  WITH CHECK (public.flow_in_scope(entity_path));
