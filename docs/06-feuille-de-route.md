# Feuille de route

Onze jalons, du socle à la publication. Chacun est _livrable_ : il se termine sur quelque chose qui
se lance et qu'on peut éprouver, jamais sur une couche à moitié posée en attendant la suivante.

L'ordre n'est pas négociable sur un point : **l'exécution d'un bot arrive tôt** (J3). C'est la raison
d'être du produit, et la repousser derrière les écrans d'administration ferait concevoir tout le
reste sans savoir ce que l'exécution exige vraiment.

> **Les onze jalons sont livrés**, et la `0.1.0` est publiée : images sur `ghcr.io/tick0001`,
> archives autonomes pour les installations sans conteneur, et le [journal](../CHANGELOG.md) qui dit
> ce que chaque version exige avant de monter. La suite ne suit plus une feuille de route mais ce
> que l'usage remonte — voir la [liste de ce que la 0.1.0 ne fait pas](../CHANGELOG.md).

## J0 — Le socle

Monorepo, outillage, intégration continue, jetons de la direction artistique, documents du dépôt.

Se termine quand `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` et `pnpm build`
réussissent sur un clone vierge.

## J1 — La base, les entités, la session et les langues

Schéma Drizzle du cœur, migrations, arbre d'entités en `ltree`, politiques Row-Level Security,
utilisateurs, profils, matrice de droits, authentification locale et session par cookie. Et
`@flow/i18n` : français et anglais, dans l'interface comme dans les messages du serveur.

Se termine quand un test d'intégration prouve, contre une vraie base PostgreSQL, qu'un compte d'une
branche ne voit pas les lignes d'une autre — et que le refus vient de la base, pas d'une clause
`WHERE`.

**Les langues arrivent ici et non à la fin**, contrairement à une première version de cette feuille
de route. Rétrofiter des traductions revient à rouvrir chaque écran déjà écrit pour en extraire les
chaînes, ce qui est long, sans intérêt, et laisse toujours des oublis que personne ne voit avant un
utilisateur. Poser le dispositif avant le premier écran ne coûte presque rien.

## J2 — Le registre des bots

`@flow/bot-sdk`, manifeste validé par Zod, chargement des modules ESM, écran de catalogue, bot de
référence.

Se termine quand un bot déposé dans `bots/` apparaît dans l'interface avec ses paramètres, sans que
rien n'ait été recompilé.

**L'API ne charge pas les modules**, et c'est ce qui décide de la forme du SDK : le manifeste est
produit à la construction, sur la machine de l'auteur, et le serveur ne lit que ce fichier JSON.
Déposer un bot revient à exécuter son auteur ; rien n'oblige à le faire dans le processus qui
détient les identifiants de la base. Voir [le SDK de bots](15-sdk-bots.md).

## J3 — L'exécution

`apps/worker`, file BullMQ, cycle de vie d'une exécution, contexte navigateur isolé par run,
annulation à travers deux process, reprise après redémarrage, balayage des exécutions orphelines.

Se termine quand un bot lancé depuis l'interface s'exécute dans le worker, qu'on peut l'interrompre,
et qu'un redémarrage de l'API en cours de route ne perd ni l'exécution ni son résultat.

## J4 — Le temps réel

Journal et progression persistés au fil de l'eau, diffusion par Redis pub/sub, relais en évènements
diffusés par le serveur, vue live du navigateur par screencast CDP.

Le relais était annoncé en WebSocket ; il se fait en SSE, pour les raisons dites dans
[l'architecture](02-architecture.md). La reprise après coupure, qui est le critère de sortie de ce
jalon, est alors dans le protocole plutôt que dans du code à écrire des deux côtés.

Se termine quand deux navigateurs ouverts sur la même exécution voient la même chose, et qu'une
coupure réseau se rattrape sans perdre les lignes émises pendant l'absence.

## J5 — L'historique

Liste et détail des exécutions, captures d'échec et traces dans le stockage de fichiers, rétention
et purge, recherche dans les logs. Voir [l'historique et le stockage](18-historique-et-stockage.md).

Se termine quand une exécution en échec se diagnostique sans ouvrir un terminal : le message, la
capture, la trace et la ligne de journal fautive sont à l'écran.

## J6 — La planification et l'API

Planifications par expression cron, clés d'API, points d'entrée REST pour lister, déclencher et
suivre, description OpenAPI dérivée des contrôleurs. Voir
[la planification et l'API](19-planification-et-api.md).

Se termine quand une chaîne d'intégration continue extérieure déclenche un bot avec une clé et
récupère son résultat, et que la description OpenAPI décrit exactement les routes qui existent.

## J7 — Le pilotage

Taux de succès, durées, tendances, bots les plus lancés, échecs les plus fréquents, tableaux de bord
et exports. Voir [le pilotage](20-pilotage.md).

Se termine quand la question « qu'est-ce qui casse le plus souvent, et depuis quand » se répond en
un écran.

Ce qui fait tenir cet écran n'est ni le graphique ni les taux, mais la **signature** : le message
d'échec débarrassé de ce qui varie. Sans elle, deux cents échecs donnent deux cents lignes uniques,
et le tableau de bord ne dit rien que la liste des exécutions ne disait déjà.

Le droit `stats:read` naît ici. Une installation déjà en service ne l'accorde à personne tant que
quelqu'un ne va pas le cocher : l'initialisation refuse de s'exécuter sur une base peuplée. Une
commande qui aligne les droits d'un profil sur le catalogue après une montée de version reste à
écrire — elle vaudra pour tous les jalons qui ajouteront un droit.

## J8 — Les plugins

`@flow/plugin-sdk`, manifeste versionné, droits déclarés, schéma SQL par plugin, hooks synchrones et
événements asynchrones, emplacements d'interface, désinstallation sans trace. Voir
[les plugins](21-plugins.md).

Se termine quand le plugin de référence exerce chaque point d'extension et tourne en test
d'intégration permanent.

Ce jalon a ajouté deux choses que l'énoncé ne nommait pas, et les deux pour la même raison — un
point d'extension qu'on ne peut pas exercer n'en est pas un.

Les **vues** : un emplacement d'interface sans voie de données ne peut afficher que du texte mort,
le cœur ne sachant pas lire les tables du plugin. Et un **canal Redis de la vie des exécutions** :
sans lui l'API n'apprend jamais qu'une exécution s'est terminée, et `execution.terminee` aurait été
une promesse vide.

Les sources d'authentification, annoncées comme point d'extension dans le périmètre, attendent J9
plutôt que d'être posées ici sans implémentation qui les éprouve.

## J9 — L'annuaire et les parcours

LDAP / Active Directory avec import, synchronisation et règles d'affectation (groupe d'annuaire →
profil + entité). Parcours de bout en bout dans un vrai navigateur. Voir
[l'annuaire et les parcours](22-annuaire-et-parcours.md).

Se termine quand un compte d'annuaire se connecte, hérite de ses droits par son groupe, et que les
parcours couvrent la connexion, le cloisonnement, le cycle de vie d'une exécution et la
planification.

**LDAP est un plugin**, comme le périmètre l'annonçait : l'écrire dans le cœur aurait fait mentir
cette phrase, et aurait posé OIDC ou SAML comme un nouveau chantier du cœur. Le plugin dit qui est la
personne et à quels groupes elle appartient ; le cœur, seul, décide de ce que cela vaut.

L'import et la synchronisation périodiques ne sont pas là : les comptes sont provisionnés à la
volée, ce qui suffit à travailler. Ce qui manque est la révocation d'un compte parti avant sa
prochaine connexion — une tâche de fond du plugin la fermera.

## J10 — La publication

Images GHCR, `compose.production.yaml`, guides d'installation en conteneurs et hors conteneurs
(Linux, Windows Server), sauvegardes, montées de version, journal des modifications, image de
prévisualisation sociale. Voir [l'installation](23-installation.md).

Se termine quand une machine vierge suit le guide et obtient une installation qui fonctionne — et que
ce qui a coincé en chemin est corrigé dans le guide, pas expliqué à l'oral.

Quatre choses ont coincé, et les quatre sont corrigées dans le code plutôt que contournées dans le
guide : `pnpm install && pnpm build` échouait sur un clone vierge ; un bot déposé dans un volume ne
trouvait pas le SDK ; la première exécution butait sur les droits d'un volume créé par Docker ; et
nginx, qui ne résout le nom d'un amont qu'une fois, relayait vers une adresse morte après chaque
redémarrage de l'API — c'est-à-dire à chaque montée de version.

---

## Ce qui est hors périmètre

**L'éditeur de flux visuel.** Un bot est du code. Le nom désigne le flux d'exécution — la file, les
étapes, la progression, le journal —, pas un canevas de nœuds à relier. Un éditeur visuel est un
produit en soi, et le prétendre en supplément le condamnerait à être mauvais.

**L'enregistrement de sessions.** `playwright codegen` existe et fait ce travail mieux qu'une
reconstitution maison.

**La compatibilité avec les bots .NET de BotManager.** La réécriture est complète, et un pont vers
des DLL ramènerait précisément la mécanique dont on se débarrasse.
