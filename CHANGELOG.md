# Journal des versions

Ce que chaque version change **pour une installation**, et ce qu'elle exige de vous avant de
monter. Les notes générées par GitHub listent les commits ; celles-ci disent s'il faut agir.

Les rubriques vont du plus urgent au plus anodin — sécurité, corrections, ajouts, changements —
plutôt que dans l'ordre de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), dont le
format est repris pour le reste. Le versionnage suit [semver](https://semver.org/lang/fr/) :
tant que le numéro majeur est `0`, une version mineure peut rompre.

Ce qui ne concerne que le dépôt — intégration continue, outillage de publication, fichiers de
communauté — n'y figure pas. Ce journal s'adresse à qui exploite Flow&, pas à qui y contribue.

## [0.2.0] — 12 septembre 2026

### Sécurité

- **Mise à disposition des bots par entité et par profil.** Le catalogue reste global à
  l'installation — un bot est un dossier sur le disque, il n'a ni entité ni propriétaire —, mais des
  règles décident désormais où chaque bot est proposé et à qui. L'entité dit où il a le droit de
  tourner, le profil dit qui, là-bas, peut le lancer.

  Le refus est appliqué en quatre endroits : le catalogue, le lancement, la création d'une
  planification et son déclenchement. L'interface ne fait que ne pas proposer — une clé d'API ou un
  onglet resté ouvert atteignent la route sans elle. Voir
  [droits des bots](docs/24-droits-des-bots.md).

- **La sonde `/api/health` répond 503 quand elle constate une dégradation.** Elle répondait 200 quoi
  qu'elle constate — base injoignable, file coupée, aucun worker à l'écoute —, et c'est le code que
  lisent Compose et les orchestrateurs. La sonde de l'image Docker ne pouvait donc échouer que si le
  processus ne répondait plus du tout, c'est-à-dire dans le seul cas où l'on n'avait pas besoin
  d'elle. Une API coupée de sa base restait au vert dans `docker compose ps`.

### Corrigé

- **Le favicon et l'aperçu social ne s'affichaient nulle part.** Les deux fichiers étaient du XML
  invalide — un `--` dans un commentaire, une esperluette isolée dans un attribut —, ce qu'un SVG ne
  pardonne pas : il est analysé en XML strict. Rien ne le signalait, ni à la construction, ni dans
  la console.

- **On ne pouvait pas changer de langue.** L'interface est bilingue et n'offrait nulle part de quoi
  basculer. Le sélecteur est dans l'en-tête, et la préférence est conservée d'une session à l'autre.

- **L'application était injoignable au téléphone.** La barre de navigation disparaissait sous 768 px
  sans rien pour la remplacer : il ne restait aucun moyen d'atteindre un autre écran.

- **Un refus de contrainte PostgreSQL rendait une 500** au lieu d'un message lisible, sur les règles
  d'annuaire : le code SQLSTATE est enveloppé par l'ORM, et n'était pas lu au bon endroit.

### Ajouté

- **Un filtre par entité dans l'historique des exécutions.** Il resserre sur une entité, sans sa
  descendance. Il ne propose que les entités qui portent des exécutions visibles — l'arbre complet
  exige `entity:read`, que la plupart des opérateurs n'ont pas — et n'apparaît qu'à partir de deux.

### Modifié

- **Les réglages remplacent la barre de navigation au lieu de s'y ajouter.** On y entre par le pied
  de barre, on en sort par le retour placé en tête.

- **La case « inclure les sous-entités » disparaît.** La descendance est toujours demandée, et le
  serveur ne l'accorde que si une habilitation récursive la couvre — ce qui était déjà le cas. Un
  badge dit la portée effective, et le filtre par entité ci-dessus rend ce qu'elle permettait.

### À faire en montant

- **Les catalogues de bots se vident.** Un bot n'est proposé que là où une règle l'ouvre, et
  l'absence de règle vaut refus. Une commande rétablit exactement le comportement d'avant, en une
  règle par bot sur l'entité racine, récursive, tous profils :

  ```bash
  docker compose -f docker/compose.production.yaml run --rm api node apps/api/dist/cli/ouvrir-les-bots.js
  ```

  Elle est idempotente. Resserrer ensuite se fait écran par écran, et chaque retrait est alors une
  décision visible plutôt qu'une surprise au premier lancement refusé.

- **La portée de `bot:read` et `bot:execute` passe à `all`** pour tous les profils, par migration.
  Ce n'est pas une élévation de privilèges : ces droits se comportaient déjà ainsi, la portée
  n'étant consultée nulle part. La matrice affichait un cloisonnement qui n'existait pas.

## [0.1.0] — 12 septembre 2026

**C'est la première version qu'on peut installer**, et elle est numérotée `0.1.0` : le majeur reste
à zéro, donc une version mineure peut encore rompre. Le journal le dira.

### Avant d'installer

- **Changer le mot de passe du rôle `flow_app`.** La première migration le crée avec un mot de passe
  écrit dans le dépôt, donc public. Ce rôle porte tout le trafic applicatif : il est protégé par le
  Row-Level Security, pas par le secret. La marche à suivre est au § 2.4 du
  [guide d'installation](docs/23-installation.md).
- **Sauvegarder `ENCRYPTION_KEY` avec la base.** La perdre rend illisibles les secrets déjà
  chiffrés ; aucune restauration ne les récupère.
- **Épingler une version d'image** plutôt que `latest` : une montée de version se décide.

### Sécurité

- Cloisonnement entre organisations appliqué par PostgreSQL, en Row-Level Security, et non par des
  clauses `WHERE` que l'on peut oublier. Éprouvé par des tests d'intégration qui échouent tous
  quand on les pointe sur le rôle propriétaire.
- Mots de passe en Argon2id, clés d'API stockées en condensat, cookie de session `SameSite=Strict`
  et `Secure`.
- L'export CSV neutralise les formules : une cellule commençant par `=`, `+`, `-` ou `@` est citée
  et préfixée, parce que la colonne des messages porte du texte lu sur les pages visitées.
- Un hook de plugin qui dépasse son délai **refuse** l'opération plutôt que de la laisser passer.

### Ajouts

- **Exécution de bots** dans un worker séparé pilotant Chromium : lancement depuis l'interface avec
  un formulaire déduit du schéma du bot, interruption à travers deux processus, reprise après
  redémarrage, balayage des exécutions orphelines.
- **Temps réel** : journal, progression et vue en direct du navigateur poussés par le serveur, avec
  reprise après coupure sans perdre ni dupliquer une ligne.
- **Historique** : captures d'échec, traces Playwright, recherche dans les journaux, rétention et
  purge héritées le long de l'arbre des entités.
- **Planification** par expression cron avec fuseau, et **clés d'API** pour déclencher depuis une
  chaîne d'intégration. Description OpenAPI dérivée des contrôleurs.
- **Pilotage** : taux de réussite, durées, tendance, et surtout les échecs regroupés par cause —
  une signature réduit deux cents messages uniques aux trois pannes qu'ils sont.
- **Plugins** : schéma PostgreSQL par plugin, droits déclarés, hooks, événements, tâches de fond,
  emplacements d'interface, désinstallation sans trace.
- **Annuaire LDAP / Active Directory** en plugin, avec règles d'affectation groupe → profil +
  entité. La base locale est interrogée d'abord : un compte d'administration de secours n'est jamais
  bloqué par un annuaire injoignable.
- **Français et anglais**, dans l'interface comme dans les messages du serveur.
- **Images conteneurisées** et pile de production, guides d'installation avec et sans conteneurs,
  sauvegarde et restauration éprouvées.

### Ce que cette version ne fait pas

- **Aucun bac à sable pour les plugins.** Un plugin s'exécute dans le processus de l'API, avec ses
  privilèges : l'installer engage autant que déployer une version.
- **Pas de synchronisation périodique de l'annuaire.** Les comptes sont provisionnés à la connexion ;
  un compte parti perd ses droits à sa prochaine connexion, c'est-à-dire peut-être jamais.
- **Une seule instance d'API pour les plugins** : installer un plugin ne le charge que sur
  l'instance qui a reçu la requête. Les autres le prendront à leur redémarrage.
- Pas d'éditeur de flux visuel, pas d'enregistrement de sessions, pas de pont vers les bots .NET de
  BotManager. Ces trois points sont hors périmètre, et le resteront.

[0.2.0]: https://github.com/tick0001/flow/releases/tag/v0.2.0
[0.1.0]: https://github.com/tick0001/flow/releases/tag/v0.1.0
