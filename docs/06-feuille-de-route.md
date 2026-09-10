# Feuille de route

Onze jalons, du socle à la publication. Chacun est _livrable_ : il se termine sur quelque chose qui
se lance et qu'on peut éprouver, jamais sur une couche à moitié posée en attendant la suivante.

L'ordre n'est pas négociable sur un point : **l'exécution d'un bot arrive tôt** (J3). C'est la raison
d'être du produit, et la repousser derrière les écrans d'administration ferait concevoir tout le
reste sans savoir ce que l'exécution exige vraiment.

## J0 — Le socle

Monorepo, outillage, intégration continue, jetons de la direction artistique, documents du dépôt.

Se termine quand `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` et `pnpm build`
réussissent sur un clone vierge.

## J1 — La base, les entités et la session

Schéma Drizzle du cœur, migrations, arbre d'entités en `ltree`, politiques Row-Level Security,
utilisateurs, profils, matrice de droits, authentification locale et session par cookie.

Se termine quand un test d'intégration prouve, contre une vraie base PostgreSQL, qu'un compte d'une
branche ne voit pas les lignes d'une autre — et que le refus vient de la base, pas d'une clause
`WHERE`.

## J2 — Le registre des bots

`@flow/bot-sdk`, manifeste validé par Zod, chargement des modules ESM, écran de catalogue, bot de
référence.

Se termine quand un bot déposé dans `bots/` apparaît dans l'interface avec ses paramètres, sans que
rien n'ait été recompilé.

## J3 — L'exécution

`apps/worker`, file BullMQ, cycle de vie d'une exécution, contexte navigateur isolé par run,
annulation à travers deux process, reprise après redémarrage, balayage des exécutions orphelines.

Se termine quand un bot lancé depuis l'interface s'exécute dans le worker, qu'on peut l'interrompre,
et qu'un redémarrage de l'API en cours de route ne perd ni l'exécution ni son résultat.

## J4 — Le temps réel

Journal et progression persistés au fil de l'eau, diffusion par Redis pub/sub, relais WebSocket,
vue live du navigateur par screencast CDP.

Se termine quand deux navigateurs ouverts sur la même exécution voient la même chose, et qu'une
coupure réseau se rattrape sans perdre les lignes émises pendant l'absence.

## J5 — L'historique

Liste et détail des exécutions, captures d'échec et traces dans le stockage de fichiers, rétention
et purge, recherche dans les logs.

Se termine quand une exécution en échec se diagnostique sans ouvrir un terminal : le message, la
capture, la trace et la ligne de journal fautive sont à l'écran.

## J6 — La planification et l'API

Planifications par expression cron, clés d'API, points d'entrée REST pour lister, déclencher et
suivre, description OpenAPI dérivée des contrôleurs.

Se termine quand une chaîne d'intégration continue extérieure déclenche un bot avec une clé et
récupère son résultat, et que la description OpenAPI décrit exactement les routes qui existent.

## J7 — Le pilotage

Taux de succès, durées, tendances, bots les plus lancés, échecs les plus fréquents, tableaux de bord
et exports.

Se termine quand la question « qu'est-ce qui casse le plus souvent, et depuis quand » se répond en
un écran.

## J8 — Les plugins

`@flow/plugin-sdk`, manifeste versionné, droits déclarés, schéma SQL par plugin, hooks synchrones et
événements asynchrones, emplacements d'interface, désinstallation sans trace.

Se termine quand le plugin de référence exerce chaque point d'extension et tourne en test
d'intégration permanent.

## J9 — L'annuaire et les langues

LDAP / Active Directory avec import, synchronisation et règles d'affectation. Interface et courriels
en français et en anglais. Parcours de bout en bout dans un vrai navigateur.

Se termine quand un compte d'annuaire se connecte, hérite de ses droits par son groupe, et que les
parcours couvrent la connexion, le cloisonnement, le cycle de vie d'une exécution et la
planification.

## J10 — La publication

Images GHCR, `compose.production.yaml`, guides d'installation en conteneurs et hors conteneurs
(Linux, Windows Server), sauvegardes, montées de version, journal des modifications, image de
prévisualisation sociale.

Se termine quand une machine vierge suit le guide et obtient une installation qui fonctionne — et que
ce qui a coincé en chemin est corrigé dans le guide, pas expliqué à l'oral.

---

## Ce qui est hors périmètre

**L'éditeur de flux visuel.** Un bot est du code. Le nom désigne le flux d'exécution — la file, les
étapes, la progression, le journal —, pas un canevas de nœuds à relier. Un éditeur visuel est un
produit en soi, et le prétendre en supplément le condamnerait à être mauvais.

**L'enregistrement de sessions.** `playwright codegen` existe et fait ce travail mieux qu'une
reconstitution maison.

**La compatibilité avec les bots .NET de BotManager.** La réécriture est complète, et un pont vers
des DLL ramènerait précisément la mécanique dont on se débarrasse.
