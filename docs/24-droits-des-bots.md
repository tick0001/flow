# Droits des bots : qui peut lancer quoi, et où

Trois questions différentes, que l'on confond facilement :

1. **Ai-je le droit de lancer des bots ?** — le droit `bot:execute` du profil actif.
2. **Ce bot-là est-il proposé ici ?** — une règle de mise à disposition.
3. **Qui verra l'exécution que je lance ?** — la portée de `execution:read` de chacun.

Ce document répond aux trois. Le modèle d'entités et de droits lui-même est décrit dans
[entités, droits et sécurité](03-entites-droits-securite.md).

---

## 1. Un bot n'appartient à aucune entité

Un bot est **un dossier sur le disque**, relu au démarrage. Il n'a ni entité, ni propriétaire, ni
ligne en base. Le catalogue est donc **global à l'installation** : il n'existe qu'un seul dossier de
dépôt, et tous les bots qui s'y trouvent sont les mêmes pour tout le monde.

C'est une conséquence, pas une décision : un bot est du code, et le code est déployé, pas saisi.
Vouloir le rattacher à une entité aurait demandé un dossier de dépôt par branche, ou une table qui
prétend posséder ce que le système de fichiers possède déjà.

**Ce qui se décide, c'est sa mise à disposition.**

## 2. Les règles de mise à disposition

Une règle dit : _ce bot est ouvert sur cette entité, pour ce profil._

| Champ  | Ce qu'il décide                                                      |
| ------ | -------------------------------------------------------------------- |
| Bot    | Lequel. L'identifiant du manifeste, `exemple.bonjour`.               |
| Entité | **Où** il a le droit de tourner.                                     |
| Portée | L'entité seule, ou toute sa descendance. Récursive par défaut.       |
| Profil | **Qui**, là-bas, peut le voir et le lancer. Vide : tous les profils. |

Deux axes, parce que ce sont deux questions distinctes. Un bot qui vide une boîte aux lettres RH n'a
rien à faire dans la branche logistique — c'est l'entité qui le dit. Et parmi les gens de la branche
RH, l'opérateur peut le lancer mais pas le lecteur — c'est le profil qui le dit. Les fondre en un
seul axe aurait forcé à répéter l'arbre des entités dans chaque profil, ou l'inverse.

Les règles **s'additionnent** : un bot est ouvert dès qu'une règle l'ouvre. Il n'existe pas de règle
de refus. Un mélange d'autorisations et d'interdictions se raisonne mal dès la troisième règle, et
personne ne sait plus dire pourquoi un bot est proposé ou non.

### L'absence de règle vaut refus

Comme partout ailleurs dans le modèle de droits. Un bot déposé n'est visible de personne tant qu'une
règle ne l'ouvre pas — ce qui est le comportement voulu pour du code que quelqu'un vient de poser sur
un serveur.

Avec une exception, sans quoi le dispositif serait inutilisable : **les porteurs de `bot:manage`
voient les bots fermés**, marqués comme tels, avec un lien vers l'écran des règles. Sans cela, un bot
fraîchement déposé serait invisible y compris de la personne chargée de l'ouvrir, et le refus par
défaut deviendrait indiscernable d'une panne du registre.

### C'est l'entité **active** qui compte, pas le périmètre

Une exécution naît dans l'entité active. Un bot ouvert seulement sur une entité fille n'est donc pas
proposable depuis le parent, même si le parent voit toute sa descendance : son lancement créerait une
trace dans une entité où il n'est pas ouvert.

L'inverse est vrai : une règle récursive posée sur un ancêtre ouvre le bot pour toute la branche.

## 3. Les deux rôles de base, et pourquoi

C'est le point le plus facile à rater, et il se rate silencieusement.

**La gestion des règles** — lister, poser, retirer — passe par le rôle applicatif, donc par le
Row-Level Security de `bot_rules`. L'administrateur d'une branche ne voit et ne pose que les règles
de sa branche. Ce cloisonnement compte autant que celui des règles d'annuaire : une règle de bot
décide **quel code s'exécutera chez qui**, et ouvrir sur le siège un bot qui s'authentifie avec les
identifiants du siège ne doit pas être à la portée de l'administrateur d'une filiale.

**La résolution** — ce bot est-il ouvert ici ? — passe par le rôle propriétaire, et doit y passer.
Une règle posée sur la racine, récursive, ouvre le bot à toute l'installation ; quelqu'un qui
travaille trois niveaux plus bas ne voit pas cette ligne, puisqu'elle est au-dessus de son périmètre.
Résoudre sous le rôle applicatif conclurait donc « fermé » pour exactement les bots ouverts le plus
largement.

C'est un calcul de droit, au même titre que la résolution du périmètre, et les calculs de droit
lisent au-dessus de soi. Un test d'intégration le vérifie, et il rougit dès qu'on repasse la
résolution sous le rôle applicatif.

**Conséquence assumée** : un administrateur de branche peut constater qu'un bot est ouvert chez lui
sans pouvoir voir la règle qui l'ouvre, ni la retirer. C'est le comportement correct — la règle
appartient à qui l'a posée, plus haut.

## 4. Où le refus est appliqué

Trois endroits, et l'interface n'en fait pas partie : elle ne propose que ce qui est ouvert, mais
elle n'est pas un contrôle d'accès.

| Endroit                      | Ce qui se passe                                                           |
| ---------------------------- | ------------------------------------------------------------------------- |
| `GET /api/bots`              | Les bots fermés sont retirés de la liste, sauf pour `bot:manage`.         |
| `POST /api/executions`       | Refus, y compris par clé d'API ou depuis un onglet resté ouvert.          |
| Création d'une planification | Refus immédiat, plutôt qu'une planification qui ne lancerait jamais rien. |
| Déclenchement planifié       | La passe saute la planification et le journalise.                         |

Le refus au lancement dit « ce bot n'existe pas sur cette installation », exactement comme pour un
identifiant inconnu. Distinguer les deux confirmerait l'existence d'un bot dont on a justement
décidé qu'il ne serait pas proposé ici.

Une planification n'est pas un droit acquis : retirer la règle arrête les déclenchements suivants.

## 5. La portée des droits `bot:read` et `bot:execute`

Elle n'admet que `all`, et ce n'est pas un oubli.

Ces deux droits sont des **capacités** : « ce profil peut consulter le catalogue », « ce profil peut
lancer ». Le catalogue n'ayant ni entité ni auteur, une portée `entity` ou `own` n'y filtrerait rien.
Les proposer afficherait dans la matrice de droits un cloisonnement qui n'existe pas — c'est ce que
faisaient les versions jusqu'à la `0.1.0`, où un profil réglé sur `entity` voyait en réalité tous les
bots de l'installation.

Le cloisonnement existe, mais il est porté par les règles. Les deux se combinent :

> Pour lancer un bot, il faut **et** `bot:execute` sur son profil actif, **et** une règle qui ouvre ce
> bot sur l'entité active pour ce profil.

## 6. Qui voit l'exécution

Une fois le bot lancé, sa visibilité ne dépend plus des règles mais de deux couches :

1. **Le Row-Level Security** borne la lecture au périmètre de travail du lecteur. C'est l'enveloppe
   extérieure, et rien n'en sort.
2. **La portée de `execution:read`** resserre à l'intérieur : `own` aux siennes, `entity` à l'entité
   active sans sa descendance. `recursive` et `all` n'ajoutent rien — le périmètre est déjà leur
   plafond.

Donc, concrètement : **M. A lance un bot dans son entité.** Ses collègues de la même entité la voient
si leur profil porte `execution:read` en `entity` ou plus large ; ils ne la voient pas si leur profil
est en `own`. Le profil `Observation` créé à l'initialisation est en `own` : c'est un choix, et il se
change dans l'écran des profils.

## 7. Monter depuis la 0.1.0

**Les catalogues se vident**, puisqu'aucune règle n'existe encore. Une commande rétablit exactement
le comportement d'avant — une règle par bot déposé, sur l'entité racine, récursive, tous profils :

```bash
# En conteneurs
docker compose -f docker/compose.production.yaml run --rm \
  api node apps/api/dist/cli/ouvrir-les-bots.js

# Sans conteneur
node apps/api/dist/cli/ouvrir-les-bots.js
```

Elle est idempotente. C'est le point de départ le plus large ; resserrer ensuite se fait écran par
écran, et chaque retrait est alors une décision visible plutôt qu'une surprise au premier lancement
refusé.

## 8. Ce que ce modèle ne fait pas

**Pas de droit `lire mais pas lancer` par bot.** La distinction existe au niveau du profil
(`bot:read` contre `bot:execute`) et pas par bot. Une règle dit qu'un bot est disponible ; ce qu'on en
fait reste décidé par le profil. Ajouter un troisième axe multiplierait les cas sans qu'aucun usage
l'ait demandé.

**Pas de règle de refus.** Voir plus haut : les règles s'additionnent.

**Pas de quota par bot ni par entité.** La colonne existe depuis le jalon J1 et n'est toujours lue
par personne — voir [le cycle d'une exécution](16-cycle-d-execution.md).
