# Entités, droits et sécurité

C'est le cœur du modèle. Tout le reste en découle : un objet mal rattaché ou un droit mal résolu
donne une fuite de données entre organisations.

Le dispositif est celui de Tick&, à quelques différences près que ce document signale — c'est un
modèle éprouvé, et le réinventer pour un domaine voisin n'aurait rien apporté.

## 1. L'arbre des entités

Une hiérarchie unique, racine comprise.

```
Racine
├── Siège
│   ├── DSI
│   └── RH
└── Filiale Nord
    ├── Site A
    └── Site B
```

Représentation : `parent_id` pour la structure logique, et un **chemin matérialisé `ltree`** pour
les requêtes.

```sql
CREATE TABLE entities (
  id        bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  parent_id bigint REFERENCES entities(id),
  path      ltree NOT NULL,        -- ex. 'e1.e2.e3'
  name      text  NOT NULL,
  ...
);
CREATE INDEX ON entities USING gist (path);
```

`path <@ 'e1.e2'` retourne une entité et toute sa descendance en une comparaison indexée. Un modèle
à base de caches d'ancêtres et de descendants demanderait de tout invalider à chaque déplacement ;
ici un déplacement de sous-arbre est une mise à jour de préfixe qui redescend par déclencheur.

**Le chemin est bâti sur les identifiants, jamais sur les noms.** Il survit donc à un renommage et
ne peut pas entrer en collision — deux entités « Site A » dans deux branches sont chose courante.

Un garde-fou : une entité ne peut pas devenir sa propre descendante. Sans lui, le sous-arbre se
détacherait du reste sans qu'aucune erreur ne soit levée, et deviendrait invisible avec tout ce qui
y est rattaché.

## 2. Rattachement des objets

Chaque objet métier porte `entity_id`, et une colonne dénormalisée `entity_path ltree` maintenue
par déclencheur depuis `entities`. Elle sert uniquement à rendre les politiques indexables sans
sous-requête : c'est une dénormalisation assumée et documentée.

Une **exécution appartient à exactement une entité**, décidée à son lancement — celle du contexte
de travail. Elle n'est jamais partagée, elle est située.

## 3. Ce que Flow& n'a pas, et pourquoi

Tick& distingue deux natures d'objets : les données, à visibilité descendante, et la configuration,
à visibilité ascendante conditionnée par un drapeau `is_recursive` — un SLA défini à la racine et
marqué récursif est utilisable partout en dessous.

**Flow& n'a pas encore d'objet de configuration partagé de cette façon.** Un bot n'est pas rattaché
à une entité : il vit sur disque, il est chargé par les workers, et sa visibilité relève d'un droit,
pas d'un périmètre. La fonction `flow_config_visible` existe pourtant déjà dans la migration, parce
que les planifications et les clés d'API en auront besoin — et qu'écrire deux variantes de la même
règle à six mois d'écart est le meilleur moyen d'en obtenir deux qui diffèrent.

**Il n'y a pas non plus de groupes**, donc pas de portée `group`. Déclarer une portée que rien ne
sait résoudre reviendrait à offrir un réglage sans effet : un administrateur la choisirait, et rien
ne changerait.

## 4. L'habilitation est un quadruplet

Le lien entre un compte et ses droits n'est pas `compte → profil`. C'est :

```
(compte, profil, entité, récursif)
```

Un même compte peut être **administrateur sur `Filiale Nord` et sa descendance** et **simple
observateur sur `Siège`**. C'est ce cumul qui rend l'outil réellement multi-organisation ; un modèle
`compte → profil` obligerait à créer deux comptes à la même personne.

`is_dynamic` distingue les habilitations posées par une règle d'affectation depuis l'annuaire —
retirées automatiquement quand le compte quitte le groupe — de celles saisies à la main, qu'une
synchronisation ne doit jamais effacer.

## 5. Contexte de travail

À la connexion, le compte obtient un **contexte** : une entité active parmi celles où il est
habilité, un profil actif, et un indicateur « inclure les sous-entités ». Il en change sans se
reconnecter.

Ce contexte détermine ce qu'il **voit**, ce qu'il **crée** — une exécution hérite de l'entité active
— et ce qu'il **peut faire**, par les droits du profil actif et eux seuls.

Il vit **en base**, dans la session, et non dans le cookie. Un cookie signé aurait suffi à le
transporter et aurait rendu impossible de révoquer une session ou de couper l'accès d'un compte
désactivé avant l'expiration du jeton.

## 6. Droits, actions et portées

Un droit n'est jamais un simple booléen. C'est le triplet **objet × action × portée** :

| Portée      | Signification                                |
| ----------- | -------------------------------------------- |
| `own`       | Les objets dont le compte est l'auteur       |
| `entity`    | Ceux de l'entité active                      |
| `recursive` | Ceux de l'entité active et de sa descendance |
| `all`       | Tous, dans le périmètre d'habilitation       |

Exemple : un opérateur a `execution:read = entity` et `execution:cancel = own`. Il voit toutes les
exécutions de son entité mais n'interrompt que les siennes.

**L'absence de ligne vaut refus** : aucune permission n'est implicite. C'est ce qui permet de lire un
profil en entier sans connaître la liste des droits qui existent — ce qui n'y figure pas est refusé.

La garde vérifie **l'existence** du droit, pas sa portée : `own`, `entity` ou `all` conditionnent
_quelles lignes_ sont concernées, ce que seule la requête peut décider.

## 7. Row-Level Security — le filet de sécurité

Le filtrage applicatif reste la première ligne : explicite, testable, et il produit des requêtes
efficaces. Le RLS est la seconde, celle qui garantit qu'un oubli dans un service — ou une requête
brute écrite par un plugin — **ne peut pas** faire fuiter des données entre organisations.

Ouverture de transaction :

```sql
SELECT set_config('flow.entity_path', 'e1.e2.e3', true),
       set_config('flow.scope_paths', '{e1.e2.e3}', true),  -- sous-arbre si récursif
       set_config('flow.exact_paths', '{}',         true),  -- entités seules sinon
       set_config('flow.user_id',     '42',         true);
```

Le `true` de `set_config` limite la portée à la transaction. Sans lui, une connexion rendue au pool
garderait le périmètre de la requête précédente : une fuite entre deux comptes, intermittente et à
peu près indiagnosticable.

Deux tableaux et non un, parce que l'habilitation porte un drapeau récursif : `scope_paths` porte
les habilitations dont toute la descendance est visible, `exact_paths` celles où seule l'entité
l'est. Les fondre obligerait à choisir un comportement unique pour les deux.

```sql
CREATE FUNCTION flow_in_scope(target ltree) RETURNS boolean AS $$
  SELECT target <@ flow_scope_paths() OR target = ANY (flow_exact_paths())
$$ LANGUAGE sql STABLE;

CREATE POLICY entities_scope ON entities FOR ALL TO flow_app
  USING (flow_in_scope(path))
  WITH CHECK (flow_in_scope(path));
```

Deux rôles PostgreSQL : un rôle applicatif soumis au RLS pour tout le trafic normal — API **et**
worker —, et un rôle propriétaire qui en est exempté, réservé à l'amorçage et à l'authentification.
Les confondre annulerait silencieusement l'isolation : rien ne casserait, et tout le monde verrait
tout.

**Le rôle applicatif est créé par la première migration**, et non par un script d'initialisation de
conteneur. C'est ce qui ferme le piège : un rôle absent en intégration continue ferait tourner les
tests d'isolation en tant que propriétaire, donc hors politiques, et ils passeraient sans rien
prouver.

### Le périmètre habilité n'est pas le périmètre de travail

Deux notions que le mot « périmètre » recouvre indistinctement :

- le **périmètre habilité** est l'union de toutes les habilitations du compte, toutes branches et
  tous profils confondus. Il n'alimente qu'une chose : le sélecteur d'entité ;
- le **périmètre de travail** est l'entité active et, si on l'a demandé _et_ qu'une habilitation
  récursive le permet, sa descendance. C'est lui, et lui seul, qui est injecté dans le RLS.

Injecter le périmètre habilité reviendrait à faire fuiter une branche dans l'autre dès qu'un compte
cumule deux habilitations. Et demander la descendance ne suffit pas à y avoir droit :
`includeSubEntities` n'est honoré que si une habilitation récursive couvre réellement l'entité
active — sans quoi la case à cocher de l'interface serait une élévation de privilège à un clic.

### Le worker écrit sous contexte, lui aussi

Une exécution appartient à un compte et à une entité, mais elle ne naît pas d'une requête HTTP. Le
worker reconstitue donc un contexte depuis la trace d'exécution et écrit sous lui. Écrire avec le
rôle propriétaire aurait été plus court, et aurait privé les journaux et les résultats du
cloisonnement que tout le reste de l'application respecte.

## 8. Ce que l'on teste obligatoirement

Ces cas sont des tests d'intégration exécutés contre une vraie base PostgreSQL **avec le rôle
applicatif**, pas des intentions. Ils vivent dans `packages/db/src/test/`.

1. Une connexion **sans contexte** voit un périmètre **vide**, jamais un périmètre total.
2. Une habilitation simple confine à sa seule entité.
3. Une habilitation récursive ouvre la descendance, sans jamais traverser latéralement ni remonter.
4. Une requête SQL brute, telle qu'en écrirait un plugin, reste confinée au même périmètre.
5. Un cumul de deux habilitations n'élargit pas une habilitation simple en récursive.
6. Une écriture visant une entité hors périmètre ne modifie aucune ligne — elle ne lève pas, elle
   ne trouve rien : un test qui n'attendrait qu'une exception passerait à côté.
7. Créer sous un parent hors périmètre est refusé.
8. Déplacer une entité met à jour tous les chemins descendants et bascule immédiatement les
   visibilités.

**La preuve que ces tests portent** : pointer `DATABASE_APP_URL` sur le rôle propriétaire les fait
tous échouer. Vérifié, et à revérifier au moindre doute — des tests d'isolation qui passent sans
isolation sont pires que pas de tests, puisqu'ils rassurent.

## 9. Ce qui n'est pas couvert par le RLS, et pourquoi

`users`, `profiles` et `profile_rights` n'ont **pas** de politique. Ce sont des référentiels globaux
à l'installation, sans colonne d'entité : un compte existe une fois, quelles que soient les branches
où il est habilité ; un profil est un jeu de droits nommé, partagé.

Ce sont donc les services qui décident ce qu'un administrateur d'une branche voit de la liste des
comptes — en la restreignant à ceux qui ont une habilitation dans son périmètre, ce qui est une
jointure sur `authorizations`, elle-même protégée par sa politique.

Poser une politique ici aurait demandé de dénormaliser une entité sur le compte, c'est-à-dire de lui
en choisir une principale : la question n'a pas de réponse pour quelqu'un habilité sur deux branches.

## 10. Un message de refus ne confirme jamais une existence

Une entité invisible et une entité inexistante rendent la même réponse. De même, créer sous un
parent hors périmètre échoue sur « entité parente introuvable » — le déclencheur lit lui-même sous
les politiques, et le parent lui est invisible.

C'est le bon comportement : un message distinguant « invisible » de « inexistante » confirmerait
l'existence d'une entité d'une autre organisation. C'est en revanche déroutant en diagnostic, et
cela vaut d'être su avant de chercher ailleurs.
