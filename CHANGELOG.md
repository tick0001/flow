# Journal des versions

Ce que chaque version change **pour une installation**, et ce qu'elle exige de vous avant de
monter. Les notes générées par GitHub listent les commits ; celles-ci disent s'il faut agir.

Les rubriques vont du plus urgent au plus anodin — sécurité, corrections, ajouts, changements —
plutôt que dans l'ordre de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), dont le
format est repris pour le reste. Le versionnage suit [semver](https://semver.org/lang/fr/) :
tant que le numéro majeur est `0`, une version mineure peut rompre.

Ce qui ne concerne que le dépôt — intégration continue, outillage de publication, fichiers de
communauté — n'y figure pas. Ce journal s'adresse à qui exploite Flow&, pas à qui y contribue.

## Non publié

Rien depuis la 0.1.0. La [feuille de route](docs/06-feuille-de-route.md) dit ce qui vient
ensuite.

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

[0.1.0]: https://github.com/tick0001/flow/releases/tag/v0.1.0
