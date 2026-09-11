# Architecture

Flow& est la réécriture d'un outil qui existait déjà : `BotManager`, en C# et Blazor Server. Ce
document dit ce que la nouvelle architecture décide, et — parce que les mêmes questions se
reposeront — ce que l'ancienne payait cher.

## Organisation du dépôt

Monorepo **pnpm workspaces + Turborepo**, comme Tick&. Le découpage matérialise la frontière entre
ce qui est public (les SDK, les contrats) et ce qui est interne, et c'est cette frontière qui rendra
les montées de version supportables.

```
apps/
  api/                  API NestJS — HTTP, session, droits, orchestration
  worker/               Playwright et les navigateurs, consommateur de la file
  web/                  Application React (Vite)
  e2e/                  Parcours de bout en bout dans un vrai navigateur
packages/
  contracts/            Types et schémas Zod partagés API ↔ web ↔ bots
  db/                   Schéma Drizzle du cœur, migrations, helpers RLS
  bot-sdk/              @flow/bot-sdk — surface offerte aux auteurs de bots
  plugin-sdk/           @flow/plugin-sdk — surface offerte aux extensions de l'application
  i18n/                 Ressources de traduction et outillage
bots/
  exemple-…/            Bot de référence, sert aussi de test d'intégration
plugins/
  exemple-…/            Plugin de référence, sert aussi de test d'intégration
docker/                 Compose, Dockerfiles, initialisation Postgres
deploy/                 Fichiers d'installation hors conteneurs
docs/
```

### Deux SDK, et non un

Un **bot** déclare des métadonnées, des paramètres et une fonction qui pilote un navigateur. Il ne
touche ni à la base, ni à l'interface, ni au pipeline HTTP. Un **plugin** étend l'application
elle-même : il a un manifeste, des droits, son schéma SQL et des emplacements d'interface à remplir.

Les réunir donnerait un contrat dont chaque auteur n'utiliserait qu'une moitié. BotManager les
séparait déjà, mais sans le dire : deux chargeurs parallèles, deux contrats sans rien de commun, et
la même mécanique d'`AssemblyLoadContext` dupliquée pour les deux. Ici la séparation est assumée, et
les deux paquets suivent leur propre semver — ce sont des contrats publics, dont les ruptures ne
suivent pas le rythme du produit.

### Numérotation des versions

Une seule version désigne le produit, et elle vit dans **`apps/api/package.json`**, lue par
`/api/health` pour qu'un exploitant sache ce qui tourne chez lui. Les autres paquets internes
restent en `0.0.0` : ils ne sont jamais publiés séparément, et leur donner un numéro laisserait
croire l'inverse. **`@flow/bot-sdk` et `@flow/plugin-sdk` font exception.**

## L'exécution : un worker séparé

C'est le changement le plus important par rapport à BotManager, où une exécution était un `Task.Run`
dans le process web, bornée par un `SemaphoreSlim`, et perdue au redémarrage.

**L'API ne lance jamais un navigateur.** Elle crée une trace d'exécution en base, publie un travail
dans la file, et rend la main. Un `apps/worker` dédié embarque Playwright et les navigateurs, dépile
et exécute.

Quatre conséquences, et c'est pour elles que la séparation existe :

- Un Chromium qui meurt n'emporte plus l'interface de tout le monde.
- Un redémarrage ne perd plus une exécution : le travail est encore dans la file.
- La charge s'encaisse en ajoutant des workers, pas en montant un compteur.
- L'image de l'API n'a plus à transporter plusieurs centaines de mégaoctets de navigateurs.

### L'état vit en base, la file ne fait que cadencer

Même principe que les escalades de Tick&. Le statut d'une exécution, ses logs et son résultat sont
en PostgreSQL ; **BullMQ ne transporte que l'intention de faire**. Un vidage de Redis ne perd donc
aucun historique, et plusieurs workers tournent sans se marcher dessus.

La concurrence est un réglage **du worker**, pas de l'application : c'est lui qui connaît la mémoire
dont il dispose. Un run coûte un navigateur, ce qui n'est pas comparable à une requête HTTP.

### L'annulation traverse deux process

Elle ne peut donc plus être un `CancellationTokenSource` en mémoire. L'API marque l'intention en
base et la publie ; le worker qui détient l'exécution l'observe et ferme son contexte.

Un worker qui n'existe plus laisse une exécution orpheline. Un balayage la termine passé un délai
sans battement de cœur, plutôt que de la laisser `running` pour toujours — et il la marque
`abandoned`, jamais `cancelled` : quelqu'un a interrompu la première, personne n'a demandé la
seconde. Les confondre effacerait la seule trace d'une panne d'infrastructure.

## L'API navigateur offerte aux bots

**Le bot reçoit la `Page` Playwright, authentique et typée.** Pas de façade.

BotManager interposait une interface `IBrowserEngine` de soixante-dix méthodes, pour rendre
Playwright et Selenium interchangeables. Le prix en était visible dans le code : chaque méthode
redéléguée à la main dans le décorateur de diffusion d'images, une implémentation Selenium qui ne
tenait pas le contrat — `GetPdfAsync` levait `NotSupportedException` — et les locators, l'attente
automatique, l'interception réseau et le tracing de Playwright rendus inatteignables.

Cette interchangeabilité n'a jamais servi. Ce qui sert, c'est tout ce que la façade masquait.

Le bot reçoit donc un **contexte** — journal, progression, paramètres déjà validés, signal
d'annulation, dossier de sortie — et la `Page`. L'enveloppe est mince et ne s'interpose pas : elle
observe, elle n'intercepte pas.

## Le chargement des bots et des plugins

Un bot est un **module ESM pré-construit** accompagné d'un manifeste, chargé par un `import()`
ordinaire. C'est tout, et c'est le point.

BotManager chargeait des DLL dans des `AssemblyLoadContext` isolés : résolution des dépendances par
`deps.json`, épinglage manuel des assemblies de contrat pour que les types restent identiques de
part et d'autre, contextes collectibles pour les bots et non collectibles pour les plugins — parce
qu'une dépendance chargée paresseusement faisait échouer le chargement sur un contexte devenu
éligible au ramasse-miettes —, `GC.Collect()` explicite pour décharger, et un `FileSystemWatcher`
avec temporisation de 700 ms pour ne pas recharger sept fois pendant une copie de fichiers.

Rien de tout cela ne subsiste. Le manifeste est validé par Zod au chargement : un bot mal formé est
refusé avec un motif lisible, et non instancié à moitié.

**Le worker charge un bot au moment de l'exécuter, et pas avant.** Une version antérieure de ce
document annonçait un ordre de relecture diffusé par la file ; l'implémentation a trouvé plus simple,
et ce paragraphe dit ce qui est fait.

Le worker relit le manifeste et compare la date du module à celle qu'il a en cache. Trois
conséquences, et c'est pour elles que le mécanisme est celui-là : un bot déposé pendant que le worker
tourne est pris au lancement suivant, sans rien à diffuser ; un module modifié est réimporté ; et un
run en cours ne voit jamais son module changer sous lui, l'import ayant lieu avant que le bot ne
démarre.

Le prix est une entrée de plus dans le cache de modules de Node à chaque version déposée, que rien ne
libère. C'est le même prix qu'un ordre de relecture aurait coûté — sans le mécanisme.

Côté API, la relecture reste explicite : un administrateur la demande depuis le catalogue. Aucune
surveillance de dossier, qui rechargerait sept fois pendant une copie de fichiers.

## Le temps réel sans circuit permanent

BotManager tenait un circuit SignalR par utilisateur et y poussait les images du navigateur en PNG
base64, toutes les 800 ms. Cela imposait des sessions collantes, ne survivait pas à une coupure
réseau, et faisait passer une vidéo par le canal qui portait aussi le rendu de l'interface.

Ici, le worker publie logs, progression et images dans **Redis pub/sub** ; l'API relaie en WebSocket
aux seuls clients abonnés à cette exécution. Les images viennent du **screencast CDP**
(`Page.startScreencast`), que le navigateur produit lui-même à la cadence des changements d'écran —
et non d'une boucle de captures qui photographie vingt fois la même page immobile.

Les logs sont persistés au fil de l'eau et non accumulés en mémoire jusqu'à la fin : une exécution
d'une heure interrompue par un incident laissait, dans BotManager, un historique vide.

## Backend — NestJS

Un module par domaine : `auth`, `entities`, `users`, `profiles`, `bots`, `executions`, `schedules`,
`apikeys`, `stats`, `plugins`, `storage`. Pas de CQRS ni d'event sourcing : de la complexité sans
contrepartie ici.

### Contexte de requête

Chaque requête HTTP ouvre un contexte propagé par `AsyncLocalStorage` : utilisateur, profil actif,
entité active, indicateur « et ses sous-entités », langue, identifiant de corrélation.

Ce contexte est injecté dans la transaction PostgreSQL sous forme de paramètres de session, et c'est
lui qui alimente les politiques **Row-Level Security**. Aucune requête métier ne filtre l'entité à la
main.

**Le worker a le même besoin sans avoir de requête.** Une exécution appartient à un utilisateur et à
une entité : le worker reconstitue donc un contexte à partir de la trace d'exécution, et écrit sous
ce contexte. Écrire avec le rôle propriétaire aurait été plus court, et aurait privé les logs et les
résultats du cloisonnement que tout le reste de l'application respecte.

## Frontend — React

Vite, React Router, TanStack Query pour l'état serveur, TanStack Table pour les listes denses,
react-hook-form et Zod pour les formulaires, Tailwind pour le rendu, i18next.

Les formulaires de paramètres d'un bot sont **générés depuis son schéma Zod**. BotManager avait un
type `BotParameter` avec un énuméré de types de contrôle et une expression régulière de validation,
c'est-à-dire un langage de description de formulaire réinventé à côté du système de types. Ici la
validation est le schéma, et l'écran est un rendu de ce schéma — une seule source, et le serveur
valide avec exactement ce que l'interface a affiché.

Les points d'extension d'interface suivent la règle de Tick& : **le contrat d'affichage est un
`render` sur un élément du DOM, pas un composant React**, pour que le bundle d'un plugin reste un
module autonome sans dépendance partagée.

## Décisions techniques argumentées

**PostgreSQL et rien d'autre pour les données.** `ltree` pour l'arbre des entités, `jsonb` pour les
paramètres d'exécution et les résultats de bots, `tsvector` pour la recherche dans les logs, et
**Row-Level Security** comme filet de sécurité de l'isolation. BotManager utilisait SQLite, ce qui
suffisait à un poste et n'aurait pas tenu plusieurs workers écrivant des logs en parallèle.

**Redis obligatoire.** File d'exécution, diffusion temps réel, verrous. Une file en mémoire ne
survit pas à un redémarrage, or une exécution planifiée manquée ne se rattrape pas toute seule.

**Drizzle plutôt que Prisma.** Le schéma se déclare par module, donc un plugin embarque ses tables
sans toucher au cœur ; le contrôle explicite des transactions rend trivial le `SET LOCAL` qui
alimente le RLS ; et le SQL généré reste lisible.

**Les captures et les traces vont dans un stockage de fichiers, pas dans la base.** BotManager
gardait la capture d'échec dans une colonne `BLOB`, ce qui l'obligeait à définir une vue allégée des
exécutions pour que la moindre liste ne charge pas les images. Abstraction de stockage avec
implémentation disque par défaut, interface compatible S3 pour plus tard, et lecture servie par
l'API — jamais par un chemin statique devinable.

**Pas de CLI NestJS, et aucun lanceur fondé sur esbuild pour le code NestJS.** Mêmes raisons que
dans Tick& : `nest build` traîne toute la chaîne `@angular-devkit`, et `tsx` comme ses équivalents
n'émettent pas `emitDecoratorMetadata`, si bien que NestJS construit des services aux dépendances
manquantes et échoue bien plus loin, sur un `undefined` sans rapport apparent.

**Playwright est installé dans l'image du worker, jamais téléchargé au démarrage.** BotManager
installait Chromium au premier lancement, ce qui faisait dépendre le démarrage d'un accès réseau et
transformait une panne de proxy d'entreprise en application qui ne démarre pas.
