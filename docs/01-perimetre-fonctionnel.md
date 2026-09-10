# Périmètre fonctionnel

Flow& exécute des **bots d'automatisation navigateur** pour le compte de plusieurs personnes, dans
plusieurs organisations, avec une trace de ce qui s'est passé.

Ce n'est ni un ordonnanceur généraliste, ni un outil de tests d'interface, ni un éditeur de
workflows. Ces trois voisinages sont proches assez pour qu'on s'y trompe, et le rappel évite d'y
glisser une fonctionnalité à la fois.

## 1. Les bots

Un bot est un **module de code** : des métadonnées, un schéma de paramètres, et une fonction qui
reçoit une page de navigateur et fait son travail.

L'application en tient un **catalogue** : nom, description, version, auteur, catégorie, paramètres
attendus. Un bot déposé apparaît sans recompilation, et son manifeste est refusé avec un motif
lisible s'il est mal formé.

Le **formulaire de lancement est déduit du schéma de paramètres**. Un bot qui veut un écran
particulier peut en fournir un, mais ce n'est pas le cas ordinaire : la plupart n'ont besoin que de
champs corrects et validés des deux côtés.

## 2. L'exécution

Chaque lancement crée une **trace** — qui, quel bot, avec quels paramètres, quand — et un travail
dans la file. Un worker le prend, ouvre un **contexte navigateur isolé**, exécute, et referme.

Pendant l'exécution : **journal horodaté** par niveau, **progression** en pourcentage et par étape,
et **vue live du navigateur** quand le run n'est pas en mode invisible. Après : statut, résultat
structuré, durée, et en cas d'échec la **capture d'écran** et la **trace** du moment fautif.

Une exécution s'**interrompt** depuis l'interface. Une exécution que plus aucun worker ne détient est
close automatiquement plutôt que laissée en cours indéfiniment.

Les exécutions au-delà de la capacité configurée **attendent leur tour** dans la file. Elles ne sont
ni refusées ni exécutées en surnombre : un run coûte un navigateur.

## 3. La planification

Un bot se planifie par **expression cron**, avec des paramètres figés pour cette planification, et
un compte auquel les exécutions sont attribuées. L'écran dit la prochaine échéance et l'historique
des passages, réussis comme manqués.

## 4. L'API

Points d'entrée REST authentifiés par **clé d'API** pour lister les bots, déclencher une exécution,
suivre son statut et récupérer son résultat. Chaque clé est rattachée à un compte : les exécutions
qu'elle déclenche portent ses droits, et non ceux d'un utilisateur technique omnipotent.

La description **OpenAPI est dérivée** des contrôleurs et des schémas qu'ils valident : elle ne peut
ni omettre une route existante ni décrire une route disparue.

## 5. Les droits et le cloisonnement

Les organisations forment un **arbre d'entités**, et l'isolation repose sur la Row-Level Security de
PostgreSQL — pas sur des clauses `WHERE` qu'on peut oublier d'écrire.

Un droit est un triplet **objet × action × portée**, et une ligne absente vaut refus. Sur les bots,
les niveaux vont de la simple visibilité au lancement puis à la configuration, et l'historique visible
suit : sa propre activité pour un utilisateur, tout le bot pour qui l'administre.

## 6. L'observabilité

Taux de succès, durées moyennes, tendances, bots les plus lancés, messages d'échec les plus fréquents,
répartition dans la journée. Recherche plein texte dans les journaux d'exécution. Exports CSV.

## 7. Les extensions

Un **plugin** étend l'application sans la forker : il déclare ses droits dans un manifeste versionné,
obtient son propre schéma PostgreSQL, remplit des emplacements d'interface, s'abonne aux événements,
ajoute des tâches de fond, et se désinstalle sans laisser de trace.

L'**authentification** est un point d'extension : la base locale d'abord, puis les sources externes
apportées par les plugins. Un succès externe sans compte local provisionne le compte à la volée. Sans
plugin, seule la base locale est consultée — un compte d'administration de secours n'est donc jamais
bloqué par un annuaire injoignable.

## 8. Les langues

Interface et courriels en **français et en anglais** dès le départ. Le projet autour d'eux est en
français : code, commentaires, documentation et messages de commit.

---

## Hors périmètre, et pourquoi

**L'éditeur de flux visuel.** Voir la [feuille de route](06-feuille-de-route.md). Un bot est du code.

**L'automatisation hors navigateur** — appels d'API, fichiers, bases de données. Un bot peut le faire
dans son propre code s'il en a besoin ; l'application ne fournit pas de briques pour cela, sans quoi
elle deviendrait un ordonnanceur généraliste et perdrait ce qui la rend utile : tout ce qui entoure
un navigateur piloté.

**Les tests d'interface en intégration continue.** Playwright s'y suffit, et une chaîne
d'intégration n'a pas besoin d'un tableau de bord multi-utilisateurs pour lancer ses tests.

**La gestion de parc et d'inventaire.** Comme dans Tick&, c'est un autre métier.
