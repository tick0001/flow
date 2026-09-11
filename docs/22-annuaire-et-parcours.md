# L'annuaire et les parcours

Ce document dit comment un compte d'annuaire obtient des droits, qui décide de quoi dans cette
chaîne, et ce qu'une campagne de parcours prouve qu'aucun autre test ne prouve.

## 1. L'authentification est un point d'extension

Elle l'est depuis la première page du [périmètre](01-perimetre-fonctionnel.md). L'écrire dans le
cœur aurait fait mentir cette phrase, et aurait posé la question suivante — OpenID Connect, SAML,
un portail qui pose un en-tête — comme un nouveau chantier du cœur à chaque fois.

LDAP est donc un [plugin](21-plugins.md), et c'est la première extension réelle de Flow&. Il ne
demande ni schéma, ni droit, ni emplacement d'interface : c'est le plugin le plus discret que cette
surface permette, et la preuve qu'elle ne force pas à tout déclarer.

### Le partage des rôles

**Le plugin dit qui est la personne et à quels groupes elle appartient. Le cœur décide de ce que
cela vaut.**

C'est la décision qui structure tout le reste. Laisser chaque source externe résoudre elle-même un
profil et une entité aurait donné autant de lectures des droits qu'il y a de plugins, et une erreur
dans l'un serait une élévation de privilèges dans toute l'installation.

Ce que le plugin rend est donc pauvre, et portable : un identifiant, un identifiant externe, un nom
affiché, une adresse, et **des noms de groupes** — des chaînes, que n'importe quelle source sait
produire.

## 2. La base locale d'abord, toujours

Un compte d'administration de secours n'est jamais bloqué par un annuaire injoignable. Cela vaut
bien plus que l'économie d'une requête : une installation dont l'annuaire tombe doit rester
administrable.

Il en découle une règle moins évidente : **un compte local ne peut pas être repris par l'annuaire.**
Si la base locale a été interrogée et n'a pas reconnu la personne, c'est que le mot de passe était
faux. Laisser l'annuaire prendre la main permettrait à qui contrôle une branche de l'annuaire de
s'emparer d'un compte local — à commencer par celui d'administration.

## 3. Deux formes de hook, deux chemins vers le même refus

Le jalon J8 n'avait qu'une forme de point d'accroche : le veto. Celui-ci en apporte une seconde,
et la différence mérite d'être vue.

|                    | `execution.avant-lancement` | `authentification.verifier`              |
| ------------------ | --------------------------- | ---------------------------------------- |
| Ce qu'il fait      | oppose un veto              | répond une identité, ou rien             |
| Qui ne répond pas  | **refuse** l'opération      | **n'authentifie** personne               |
| Un plugin qui lève | annule l'opération          | est journalisé, le suivant est interrogé |

Les deux échouent du côté fermé, par des chemins opposés. Les confondre aurait donné soit un
annuaire injoignable qui bloque toute l'application, soit un veto qu'une lenteur suffit à
contourner.

C'est aussi pourquoi une panne du plugin d'annuaire n'interrompt pas la connexion : refuser tout
parce qu'un annuaire parmi deux est tombé priverait les comptes de l'autre sans raison.

## 4. Les règles d'affectation

Une règle dit : **ce groupe donne ce profil, sur cette entité**, éventuellement avec sa descendance.

### Elles appartiennent au cœur

Un profil et une entité sont des objets du cœur. Les règles vivent donc dans sa base, avec un écran
d'administration ordinaire — et non dans le schéma du plugin, ce qui aurait demandé au plugin de
savoir lire les droits.

### Elles sont cloisonnées, et ce n'est pas cosmétique

Une règle est une **élévation de privilèges différée** : elle s'appliquera à la prochaine connexion
de quelqu'un qu'on ne connaît pas encore. Sans politique de cloisonnement, l'administrateur d'une
filiale s'accorderait l'administration du siège en posant une règle sur un groupe dont il fait
partie — et rien, dans aucun journal, ne se lirait comme une intrusion.

### Dynamique ou manuelle

Les habilitations posées par une règle portent un drapeau. **Seules celles-là sont remplacées à
chaque connexion** ; celles saisies à la main survivent.

Sans cette distinction, une synchronisation effacerait le travail d'un administrateur, et personne
ne saurait dire quand ni pourquoi — l'accès aurait simplement disparu entre deux connexions.

Dans l'autre sens, le compte qui quitte un groupe perd l'habilitation correspondante à sa connexion
suivante. C'est le sens même de la révocation par l'annuaire, et c'est pour cela que le remplacement
est complet plutôt qu'additif.

### Aucune règle ne correspond

Le compte est créé, et il n'obtient rien. Le refus dit « aucune habilitation », et c'est presque
toujours la cause quand un compte d'annuaire ne peut pas entrer : le mot de passe était bon,
l'annuaire a répondu, et pourtant l'application refuse. L'écran des règles le dit en tête, avant
qu'on ne le vive.

## 5. Le plugin LDAP

**Recherche puis liaison.** Le compte de service cherche la personne et trouve son DN ; c'est
ensuite une liaison **au nom de la personne** qui authentifie. Un DN construit par gabarit
échouerait dès que l'annuaire range ses comptes autrement qu'on ne l'avait prévu.

Trois pièges se referment dans ce plugin, et chacun se lit dans son code :

**Le mot de passe vide.** Une liaison LDAP sans mot de passe réussit, en anonyme, sur la plupart des
annuaires : le serveur répond « lié », et une application naïve en conclut à une authentification.
C'est le piège le plus connu de LDAP. Le plugin refuse avant toute connexion.

**L'injection de filtre.** Un identifiant contenant `*` ou `)` change le filtre lui-même : `(uid=*)`
rend le premier compte venu, et l'application authentifie quelqu'un d'autre. La saisie est échappée
selon la RFC 4515 — et l'espace n'en fait pas partie, contrairement à ce qu'une première version
faisait, ce qui aurait rendu introuvable tout identifiant composé de deux mots.

**Le TLS déduit d'une option.** `ldapts` conclut « connexion chiffrée » de la seule présence de
`tlsOptions`. Les passer sur une URL `ldap://` fait tenter une poignée de main TLS sur un port qui
n'en attend pas, et l'erreur — « Client network socket disconnected before secure TLS connection was
established » — ne désigne ni le protocole, ni l'option fautive. Les options ne sont donc posées que
pour `ldaps://`.

### La configuration vient de l'environnement

Le compte de service d'un annuaire est un secret d'infrastructure : il se pose au déploiement, avec
les autres, et il vit là où vivent déjà l'URL de la base et le secret de session. Le stocker en base
aurait demandé de le chiffrer, donc de gérer une clef, sa rotation et sa perte — pour une valeur que
l'exploitant pose une fois.

Le prix est réel et assumé : changer d'annuaire demande de redémarrer l'API. Un annuaire ne change
pas toutes les semaines.

Un plugin installé mais non configuré ne reconnaît personne — ce qui est exactement ce qu'un point
d'accroche d'identité fait quand il ne sait pas répondre.

## 6. Les parcours

Quatre parcours, douze cas : la connexion, le cloisonnement, le cycle de vie d'une exécution, la
planification.

**Contre la pile réelle, jamais contre des doublures.** Un vrai navigateur sur la vraie interface,
qui parle à la vraie API, qui écrit dans la vraie base — avec ses politiques, qui sont précisément ce
que le parcours du cloisonnement doit éprouver. Un parcours contre une API simulée vérifierait que la
simulation est d'accord avec elle-même.

Le décor — deux branches, trois comptes — est posé **par la base**, avec le rôle propriétaire. Il n'y
a donc aucun mot de passe d'administration à déposer dans un fichier d'environnement pour qu'une
campagne tourne. Ce qui est éprouvé, lui, passe intégralement par l'écran.

### Une vérification qui ne vérifiait rien

Le parcours du cloisonnement affirmait d'abord « le corps de page ne contient pas _Nord_ ». Une
assertion de ce genre passe **dès le premier instant**, sur une page encore blanche : elle ne pouvait
pas échouer, et elle n'échouait pas non plus quand on retirait le cloisonnement.

Le parcours attend maintenant la réponse de l'API avant d'affirmer une absence.

### Ce que la correction a révélé

Pour voir la fuite apparaître, il a fallu retirer **trois défenses indépendantes** :

1. la portée du droit, qui pose une condition d'entité dans la requête ;
2. la politique de Row-Level Security sur les exécutions ;
3. celle sur les entités, que la jointure de la liste traverse.

Retirer la première ne fuit pas. Retirer les deux premières ne fuit pas davantage. C'est ce qu'on
attend d'une défense en profondeur — et c'est désormais vérifié plutôt que supposé.

### Le worker n'est pas démarré par la campagne

Il n'écoute aucun port, et Playwright ne saurait pas dire quand il est prêt. Le parcours du cycle
d'une exécution l'exige donc, et le dit — plutôt que d'attendre une exécution que personne ne
dépile.

## 7. Ce qui reste

- **L'import et la synchronisation périodiques.** Les comptes sont provisionnés à la volée, à la
  connexion, ce qui suffit à travailler : un compte inconnu n'a de toute façon rien à voir avant
  d'être entré. Ce qui manque est la révocation d'un compte parti — aujourd'hui, il perd ses droits
  à sa prochaine connexion, c'est-à-dire peut-être jamais. Une tâche de fond du plugin, relisant
  l'annuaire, le fermerait.
- **Le rattachement d'un compte local à l'annuaire**, pour une installation qui bascule. Il demande
  une décision d'exploitant, pas une devinette du code.
- **Les parcours en intégration continue** : la campagne réclame la pile complète, ce que le jalon
  J10 posera avec les images.
