# La planification et l'API

Ce document dit comment un bot se déclenche sans personne devant l'écran, comment une chaîne
extérieure l'appelle, et pourquoi la description OpenAPI ne peut pas mentir.

## 1. Les planifications vivent en base

BullMQ sait porter des travaux répétitifs. Les utiliser aurait fait vivre les planifications dans
Redis — et un vidage les aurait toutes emportées.

Une planification perdue **ne se remarque pas**. Rien n'échoue, rien ne s'affiche en rouge : le
travail cesse simplement d'arriver, et on s'en aperçoit la semaine suivante quand quelqu'un demande
où est le rapport. C'est le même principe qu'aux jalons précédents — l'état vit en base, la file ne
porte que l'intention de faire — et c'est ici qu'il compte le plus.

Le planificateur de l'API interroge donc la table toutes les trente secondes. Une expression cron à
cinq champs ne descend pas sous la minute ; interroger deux fois par minute suffit à ne jamais
décaler un déclenchement de plus de trente secondes.

### Cinq champs, pas six

Le sixième champ — les secondes — existe dans certaines bibliothèques. Il n'a pas sa place ici : une
exécution ouvre un navigateur, ce qui prend des secondes. Une planification à la seconde promettrait
une précision que rien ne peut tenir, et inviterait à déclencher toutes les dix secondes un travail
qui en prend trente.

### Le fuseau est obligatoire

« Neuf heures » ne veut rien dire sans lui : le serveur tourne peut-être en UTC, l'organisation est
ailleurs, et l'heure d'été décale les deux fois par an. Le stocker par planification résout aussi le
cas d'une installation qui sert plusieurs pays depuis la même base.

Il est **vérifié à la création**, pas au déclenchement : une planification posée avec `Europe/Pris`
ne se déclencherait sinon jamais, en silence.

## 2. Une occurrence manquée est perdue

C'est la décision qui structure tout le reste.

Une installation arrêtée tout un week-end a manqué des dizaines d'occurrences d'une planification
horaire. Les rattraper produirait une rafale au redémarrage — des dizaines de navigateurs lancés
d'un coup, sur des données dont la fenêtre est passée. Ce qu'un bot devait faire à neuf heures n'a
plus de sens à dix-sept.

Le prochain déclenchement est donc calculé **depuis maintenant**, jamais depuis l'occurrence
manquée. Un traitement qui doit impérativement passer se déclenche par l'API, où l'appelant sait quoi
faire d'un échec.

### Plusieurs instances d'API

Le `FOR UPDATE SKIP LOCKED` arbitre : chaque ligne n'est vue que par une instance, et les autres
passent à la suivante au lieu d'attendre. Sans lui, deux instances déclencheraient la même
planification à la même seconde.

L'échéance est repoussée **dans tous les cas**, y compris quand le lancement échoue. Sans cela, une
planification dont le bot a été retiré serait reprise à chaque passe, indéfiniment, et remplirait les
journaux deux fois par minute.

## 3. Les clés d'API

**Une clé agit comme son créateur**, avec le profil et l'entité qu'il avait au moment où il l'a
créée. Ni l'un ni l'autre à choisir.

La règle tient en une phrase — _une clé ne peut jamais faire plus que la personne qui l'a créée_ — et
elle ferme d'un coup toute une famille de questions sur l'élévation de privilèges. Elle a un coût,
assumé : changer le périmètre d'une clé demande d'en créer une autre. C'est le bon sens pour un
secret qu'on ne peut de toute façon pas relire.

Elle porte le **même contexte de travail qu'une session**, si bien que rien en aval n'a besoin de
savoir d'où vient l'appel : politiques de cloisonnement, droits et portées s'appliquent à
l'identique.

### Le cookie d'abord

Un navigateur qui porte les deux — un outil de test d'API ouvert dans un onglet connecté — doit agir
comme la personne connectée, pas comme la clé : c'est ce qu'elle voit à l'écran, et l'inverse serait
déroutant.

### SHA-256 et non Argon2

La différence avec un mot de passe est justifiée. Un mot de passe est choisi par un humain, donc
devinable, et le coût de calcul d'Argon2 est ce qui rend l'attaque par dictionnaire impraticable.
Une clé est **256 bits tirés au hasard** : il n'y a pas de dictionnaire, et ralentir la vérification
ne ralentirait que les appels légitimes.

Seul le condensat est stocké. Une clé perdue se remplace, elle ne se retrouve pas — et une fuite de
la base ne livre aucune clé utilisable.

### Le préfixe, et la dernière utilisation

Le début de la clé est gardé en clair. Il ne permet pas de s'authentifier, et il rend la clé
**identifiable** : sans lui, révoquer « celle de la chaîne d'intégration » demanderait de deviner
laquelle, ou de toutes les révoquer.

La date de dernière utilisation répond à la seule question qu'on se pose avant de couper une clé :
_sert-elle encore ?_ Sans elle, personne n'ose jamais retirer une clé dont on ne sait plus à quoi
elle servait.

Elle est écrite **hors de la transaction de lecture**. Une première version l'écrivait dedans, sans
l'attendre — et un constructeur de requête Drizzle est paresseux : sans `await`, la requête n'était
jamais exécutée. Le défaut se voyait mal, la clé fonctionnant parfaitement par ailleurs.

L'écriture est espacée d'une minute : une chaîne qui appelle cent fois par minute produirait sinon
cent écritures sur la même ligne, pour une information dont la minute suffit largement.

### On ne crée pas une clé avec une clé

Rien ne l'interdit techniquement — le contexte est le même. Mais une clé qui peut en émettre
d'autres transforme une fuite unique en fuite permanente : révoquer la première ne révoque pas celles
qu'elle a créées.

## 4. La description OpenAPI

Elle est **déduite des contrôleurs**, et produite sans démarrer l'application : ni base, ni Redis, ni
dossier de bots. Une description qui exigerait une installation qui tourne ne serait générée ni en
intégration continue, ni sur le poste de qui veut écrire un client.

Les formes des corps et des requêtes viennent du **tuyau de validation**, dont le schéma est public
depuis le jalon J0 précisément pour cela. La documentation dit donc ce que le code vérifie
réellement, plutôt que ce qu'une annotation tenue en parallèle prétendrait — et qui aurait commencé à
mentir au premier champ ajouté.

Chaque opération porte le droit qu'elle exige. Savoir qu'une route demande `schedule:create` évite de
découvrir le refus en production.

### Le test compare au routeur, pas aux métadonnées

C'est tout l'intérêt. Comparer les métadonnées à une description déduite des **mêmes** métadonnées ne
prouverait rien : les deux côtés diraient la même chose par construction, y compris quand ils ont
tort.

Le test boote donc l'application et lit la pile du routeur Express — ce qui sert réellement — puis
vérifie qu'aucune route n'est servie sans être décrite, et qu'aucune n'est décrite sans être servie.
Il refuse aussi un document vide, qui passerait les deux vérifications précédentes.

## 5. Ce que ce jalon ne fait pas

**La limitation de débit par clé.** Une clé peut appeler autant qu'elle veut. La limite utile n'est
pas le nombre d'appels mais le nombre d'exécutions simultanées, et ce quota-là — par entité — attend
toujours son mécanisme.

**Les portées par clé.** Une clé hérite des droits de son créateur, en entier. Pouvoir restreindre
une clé à « lancer, mais pas administrer » serait utile ; cela demande un modèle de portées distinct
de celui des profils, et le bricoler affaiblirait les deux.

**La rotation assistée.** Remplacer une clé demande d'en créer une nouvelle, de basculer l'appelant,
puis de révoquer l'ancienne. C'est exactement la bonne procédure ; l'automatiser demanderait que
Flow& sache où la clé est configurée, ce qu'il ne peut pas savoir.
