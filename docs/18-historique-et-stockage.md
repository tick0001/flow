# L'historique et le stockage de fichiers

Ce document dit où vont les captures, les traces et les fichiers qu'un bot produit, combien de temps
ils restent, et comment un échec se diagnostique sans ouvrir un terminal.

## 1. La base garde la trace, le stockage garde le contenu

L'outil remplacé gardait la capture d'échec dans une colonne `BLOB`. Cela l'obligeait à définir une
vue allégée des exécutions pour que la moindre liste ne charge pas les images — une complication qui
se propage à chaque requête, pour un problème qu'on s'était créé.

Ici, une ligne de pièce pèse quelques centaines d'octets : de quoi nommer le fichier, le typer, le
dimensionner et le retrouver. Une liste peut joindre ses pièces sans précaution.

`@flow/storage` est **partagé entre le worker et l'API** : le premier écrit, la seconde sert.
L'interface est volontairement pauvre — écrire, lire, décrire, supprimer, supprimer un préfixe — pour
qu'une implémentation S3 se pose sans rien changer autour. Pas de chemin, pas de permissions : une
clef opaque et des flux.

**Sur une seule machine cela va de soi ; sur plusieurs, l'API et les workers doivent voir le même
dossier** — un volume partagé — ou parler à S3.

## 2. Les clefs, et pourquoi elles sont vérifiées deux fois

Une clef est composée d'identifiants que l'application produit. Mais le nom d'un fichier déposé par
un bot vient, lui, de l'extérieur : c'est du code arbitraire écrit par un tiers qui choisit ce nom.
Un `../../etc/passwd` écrirait là où personne ne l'attend.

D'où deux contrôles : la **forme de la clef** à l'écriture comme à la lecture, et le **chemin
résolu** au moment d'ouvrir le fichier. Le second est celui qui tient quoi qu'il arrive — y compris
pour une clef relue en base qu'une version antérieure y aurait écrite. Une défense qui dépend de la
qualité de ses appelants n'en est pas une.

Les exécutions sont réparties sur deux niveaux tirés de leur identifiant
(`executions/0f/3b/<uuid>/`). Un dossier unique tiendrait quelques années puis deviendrait pénible :
lister, sauvegarder ou parcourir un dossier de plusieurs centaines de milliers d'entrées est lent sur
à peu près tous les systèmes de fichiers. La répartition vient de l'identifiant et non d'une date,
si bien que **la purge retrouve les fichiers d'une exécution sans relire la ligne qu'elle vient de
supprimer**.

## 3. Ce qu'une exécution laisse derrière elle

| Nature       | Quand                     | Traitement à l'écran        |
| ------------ | ------------------------- | --------------------------- |
| `screenshot` | Échec seulement           | Affichée, ouvrable en grand |
| `trace`      | Échec seulement           | Téléchargée                 |
| `output`     | Tout ce que le bot dépose | Listée, téléchargeable      |

**La récolte a lieu avant la fermeture du contexte navigateur**, et c'est l'ordre qui compte : une
capture se prend sur une page ouverte, une trace s'arrête sur un contexte vivant. Après, il n'y a
plus rien à photographier.

**La trace est enregistrée pour tous les runs et gardée pour les seuls échecs.** Personne ne sait
d'avance lequel échouera, et une trace de run réussi ne sert à personne tout en pesant des
méga-octets. Le coût de l'enregistrement est réel et permanent — il ralentit aussi les exécutions qui
réussiront — d'où le réglage `WORKER_TRACE`.

Le dossier de sortie est un **espace de passage**. Ce que le bot y écrit part au stockage, où l'API
sait le servir, puis le dossier disparaît. Le garder sur le disque du worker le rendrait invisible
depuis l'interface et ferait grossir la machine sans que personne ne l'ait décidé.

### Ce qui n'a pas de capture

Une exécution **interrompue** n'en a pas : l'interruption ferme le contexte navigateur — c'est ce qui
arrête réellement un bot — et il n'y a alors plus rien à photographier. Le journal et le statut
disent ce qui s'est passé, et quelqu'un qui vient d'interrompre sait pourquoi.

## 4. Servi par l'API, jamais par un chemin statique

Un dossier exposé derrière un serveur de fichiers aurait donné des adresses devinables, et aurait
contourné le cloisonnement que tout le reste applique. Une capture d'écran de page authentifiée est
précisément ce qu'on veut le moins voir fuiter.

Chaque pièce se demande donc par son identifiant, sur une route qui relit la ligne sous le rôle
applicatif : une pièce dont l'exécution est hors périmètre est **introuvable**, et le refus ne
distingue pas « invisible » de « inexistante ».

Une pièce ne change jamais — son identifiant est unique, son contenu est figé à l'écriture — d'où un
cache privé d'un an. Le type décide de la disposition : `inline` pour une image, qu'on veut voir dans
la page, `attachment` pour le reste.

## 5. La rétention se résout en remontant l'arbre

Une entité qui ne règle rien hérite de son parent, jusqu'à la racine ; la racine sans réglage prend
celle de l'installation. C'est le sens de la colonne nulle, posée au jalon J1 et que rien ne lisait
encore.

**Zéro désactive la purge**, et c'est un choix légitime — un historique qui ne s'efface jamais. Il
doit s'écrire plutôt que se subir : le défaut est quatre-vingt-dix jours, parce qu'un stockage qui
grossit sans fin finit par tomber un jour où personne ne s'y attend.

**Les fichiers sont retirés avant la ligne.** Dans l'autre sens, une interruption entre les deux
laisserait des fichiers que plus rien ne référence : invisibles, et personne ne les retrouverait
jamais. Ici le pire cas est une ligne dont le fichier a disparu — visible, et rattrapée par la passe
suivante.

La purge passe une fois par heure, là où l'entretien des exécutions orphelines passe toutes les
quinze secondes. Une exécution orpheline doit se voir vite ; une rétention porte sur des jours.

## 6. Chercher dans les journaux

Un index trigramme, posé avec la table : le créer plus tard demanderait de le bâtir sur des millions
de lignes déjà écrites.

Des trigrammes et non une recherche plein texte, parce qu'on cherche un fragment — un identifiant, un
sélecteur CSS, un morceau de trace. Le plein texte aurait racinisé « ETIMEDOUT » et découpé
`#form > input[name]` en mots, ce qui est exactement ce qu'il ne faut pas ici.

Le motif est **échappé** avant d'entrer dans le `LIKE`. Sans cela, chercher « 100% » rendrait toutes
les lignes : le pourcentage y signifie « n'importe quoi ». Le contresens est silencieux, ce qui est
le pire genre — on croit que le filtre ne marche pas, alors qu'il marche trop bien.

Le filtrage de l'écran de détail, lui, se fait **dans le client**, sur les lignes déjà reçues :
redemander au serveur à chaque frappe casserait le flux temps réel, et les lignes qui arrivent
pendant qu'on tape ne passeraient pas par le même chemin.

### Une erreur, et sa correction

Un second index sur `lower(message)` a été posé ici, au motif que `gin_trgm_ops` n'aurait servi que
`LIKE` et pas `ILIKE`. **C'est faux** : la classe d'opérateurs sert aussi `ILIKE`, `~` et `~*`, et le
plan le montre. L'index a été retiré et la recherche s'écrit `ILIKE` : le second aurait doublé le
coût d'écriture de la table qui grossit le plus vite du schéma, pour rien.

Le genre d'affirmation qu'on vérifie avec `EXPLAIN` plutôt qu'avec sa mémoire.

## 7. Ce que ce jalon ne fait pas

**Le balayage des fichiers orphelins.** Un fichier écrit dont la ligne n'a jamais été posée — une
panne entre les deux — reste invisible sur le disque. Le préfixe de son exécution le fera disparaître
à la purge de celle-ci ; il n'y a pas de balayage général, qui demanderait de lister tout le
stockage pour le confronter à la base.

**La recherche à travers les exécutions.** On cherche dans le journal d'une exécution, pas dans ceux
de toutes. L'index le permettrait ; l'écran qui le mérite est celui du pilotage, au jalon J7.

**La compression des vieilles traces.** Une trace est déjà une archive ; la recompresser ne
gagnerait rien. Les reléguer vers un stockage moins cher est une affaire d'exploitation, pas
d'application.
