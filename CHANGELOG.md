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

**Aucune version n'est encore étiquetée**, et il n'y a donc rien à installer ni à mettre à jour.
Le projet en est au jalon J9 sur onze : les bots s'exécutent dans un worker séparé, se lancent
depuis l'interface, par expression cron ou par clé d'API, s'interrompent, se regardent travailler en
direct, leurs échecs se diagnostiquent à l'écran, l'écran de pilotage dit ce qui casse le plus
souvent et depuis quand, des plugins étendent l'application sans qu'on la forke, et un compte d'annuaire LDAP se connecte
en héritant de ses droits par ses groupes.

Un avertissement qui vaudra pour la première version installable : **un plugin s'exécute dans le
processus de l'API, avec ses privilèges**. Il n'y a pas de bac à sable, et le droit de les installer
équivaut au droit de déployer du code. La [feuille de route](docs/06-feuille-de-route.md) dit ce qui
vient ensuite.

La première entrée de ce journal sera écrite quand une installation deviendra possible.
