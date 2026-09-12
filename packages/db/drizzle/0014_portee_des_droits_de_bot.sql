-- =============================================================================
-- Realignement de la portee de `bot:read` et `bot:execute`.
--
-- Ces deux droits proposaient `own | entity | recursive | all`, et un profil
-- regle sur `entity` laissait croire que ses porteurs ne voyaient que les bots
-- de leur entite. Ce n'etait pas le cas : le catalogue est un dossier sur le
-- disque, sans entite ni auteur, et la portee n'etait consultee nulle part. La
-- matrice de droits affichait donc un cloisonnement qui n'existait pas.
--
-- Le cloisonnement existe desormais, porte par `bot_rules` : une regle ouvre un
-- bot sur une entite, pour un profil ou pour tous. La portee du droit, elle,
-- reste sans objet et n'admet plus que `all`.
--
-- Les lignes existantes sont ramenees a `all`. Ce n'est pas une elevation de
-- privileges : elles se comportaient deja ainsi, la valeur stockee ne changeant
-- rien a ce que le serveur servait. La conserver aurait laisse des lignes que le
-- catalogue refuse desormais, et que l'ecran des profils n'aurait pas su
-- afficher.
-- =============================================================================

UPDATE profile_rights
   SET scope = 'all'
 WHERE object = 'bot'
   AND action IN ('read', 'execute')
   AND scope <> 'all';
