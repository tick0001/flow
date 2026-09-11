# Les plugins

Ce document dit ce qu'un plugin peut faire, ce qu'il ne peut pas, et surtout ce que ce dispositif
**ne protège pas** — parce que c'est la première chose à savoir avant d'en installer un.

## 1. Un plugin s'exécute dans l'API, avec ses privilèges

Il n'y a pas de bac à sable.

Un bot est du code que le worker exécute à distance : l'API ne l'importe jamais, elle ne lit que son
manifeste JSON. Cette séparation est réelle et elle est documentée dans
[le SDK de bots](15-sdk-bots.md).

Un plugin, non. Ses hooks s'exécutent dans le chemin des requêtes, ses événements dans le processus
de l'API, ses tâches sur son minuteur. Il partage le tas, les privilèges et la connexion à la base.
Un plugin peut faire tout ce que l'application peut faire.

**Installer un plugin engage donc autant que déployer une version.** L'écran d'administration le
dit en toutes lettres, et le droit `plugin:manage` est le plus puissant du catalogue : l'accorder
revient à accorder le droit de déployer du code.

Ce qui est tenu, en revanche :

- **Rien n'est importé qui ne soit installé et actif.** Un dossier posé sur le serveur ne s'exécute
  pas parce qu'il est là. C'est toute la différence entre déposer un fichier et installer une
  extension.
- **Le manifeste est lu avant le module.** Un manifeste illisible, invalide, ou écrit pour une
  majeure que l'installation ne sert plus est refusé sans qu'une ligne du plugin ne soit exécutée.
  C'est la seule vérification possible de l'extérieur.
- **Un plugin ne peut pas s'installer lui-même.** Créer un schéma demande le rôle propriétaire ;
  un plugin n'a que la connexion applicative, qui se voit refuser l'ordre par PostgreSQL.

## 2. Le manifeste

Produit **à la construction**, par `flow-plugin manifeste dist/index.js`, à partir du module
construit. Il décrit l'identité, la majeure visée, et tout ce que le plugin touche : droits, tables,
accroches, événements, emplacements, vues, tâches.

Les hooks et les événements ne s'y déclarent pas à la main : ils sont **déduits des fonctions
réellement fournies**. Deux listes — celle du manifeste et celle du code — auraient fini par ne plus
s'accorder, et l'API aurait attendu à chaque lancement un hook que personne n'implémente.

## 3. Le schéma PostgreSQL

Un plugin qui écrit demande un schéma. Il obtient `plugin_<identifiant>`, ses migrations sont jouées
dans l'ordre de leurs noms, une seule fois, et les noms joués sont inscrits en base — une montée de
version ne rejoue donc que ce qui est nouveau.

Pendant l'installation et à l'exécution, le `search_path` pointe sur son schéma puis sur `public` :
ses tables se nomment sans préfixe, celles du cœur restent lisibles, et un plugin ne peut pas semer
une table dans `public` par mégarde.

### Le cloisonnement est celui du cœur

C'est le point qui porte tout le reste.

Une table de plugin qui porte une entité déclare une politique qui appelle **`flow_in_scope`, la
fonction du cœur** :

```sql
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_scope ON notes FOR ALL TO flow_app
  USING (public.flow_in_scope(entity_path))
  WITH CHECK (public.flow_in_scope(entity_path));
```

Une extension n'invente pas son isolation et n'a pas à la réimplémenter en clauses `WHERE`. Le
plugin de référence n'écrit pas une seule condition d'entité, et la filiale nord ne voit pas les
notes de la racine — le test d'intégration le vérifie, et échoue quand on retire la politique.

Les privilèges par défaut du schéma sont posés **avant** les migrations : ils ne valent que pour ce
qui sera créé ensuite. Les poser après laisserait des tables que l'application ne pourrait pas lire,
et l'erreur ne se verrait qu'au premier appel du plugin.

## 4. Les hooks et les événements

Deux mécanismes, et les confondre aurait donné soit des événements capables de casser
l'application, soit des hooks incapables de refuser quoi que ce soit.

|                     | Hook                                | Événement                        |
| ------------------- | ----------------------------------- | -------------------------------- |
| Quand               | dans le chemin de l'opération       | après coup                       |
| Attendu             | oui, en série, dans un ordre stable | non                              |
| Peut refuser        | oui                                 | non                              |
| Une exception       | annule l'opération                  | est journalisée, et rien de plus |
| Borné dans le temps | oui                                 | sans objet                       |

### Le dépassement refuse, il ne laisse pas passer

C'est le choix qui compte, et il mérite d'être défendu.

Un hook est là pour dire oui ou non. Celui qui n'a pas répondu n'a pas dit oui, et poursuivre
reviendrait à décider à sa place — exactement l'inverse de ce qu'on lui a demandé. Un plugin qui
vérifie une règle métier avant chaque lancement cesserait silencieusement de l'appliquer le jour où
il devient lent. Le refus, lui, se voit tout de suite.

### Le refus se distingue de la panne

Un `RefusPlugin` porte un motif écrit pour la personne qui vient de cliquer, et il lui est montré
tel quel. Toute autre exception annule aussi l'opération, mais se présente comme une panne du
plugin. Sans cette distinction, les deux s'afficheraient de la même façon, et l'utilisateur
chercherait ce qu'il a mal fait devant une erreur qui ne le concerne pas.

### Les hooks sont consultés avant l'écriture

Un refus ne doit rien laisser derrière lui. Consulter après aurait produit une exécution mort-née
dans l'historique, qu'il aurait ensuite fallu expliquer.

### Les événements viennent d'un canal global

Le worker publie le départ et la fin de chaque exécution sur un canal Redis que toutes les instances
d'API écoutent en permanence — à la différence du relais temps réel, qui ne s'abonne que si
quelqu'un regarde.

Sans ce canal, l'API n'apprend jamais qu'une exécution s'est terminée : elle le découvre en relisant
la base quand on le lui demande, ce qui suffit à afficher une page et pas à déclencher quoi que ce
soit. `execution.terminee` aurait été une promesse vide — et c'est justement l'exécution nocturne
que personne ne regarde qui intéresse un plugin.

L'invariant du jalon J4 vaut ici aussi : la ligne est écrite avant d'être publiée. Un plugin qui
relit l'exécution à la réception la trouve dans l'état annoncé.

## 5. Les tâches de fond

Un plugin déclare une période, au minimum la minute, et une fonction. Un seul minuteur les sert
toutes : les tâches vont et viennent avec les plugins, et un minuteur par tâche aurait demandé d'en
créer et d'en détruire à chaque activation — avec la fuite qui finit toujours par arriver quand on
oublie une destruction.

Une tâche qui déborde n'est pas relancée en parallèle. Et la première ne part qu'après une période
complète : sans cela, chaque redémarrage lancerait toutes les tâches de tous les plugins d'un coup.

**Une tâche tourne sans acteur, et voit donc toute l'installation.** C'est assumé et non subi : une
purge périodique qui ne verrait rien ne purgerait rien. Un plugin qui écrit une tâche doit le
savoir, et le SDK le lui dit.

## 6. L'interface, et les vues

Le contrat d'un emplacement est **un `render` sur un élément du DOM, pas un composant React**.
C'est la règle de la collection, et elle se paie en quelques lignes d'impératif côté application.
Elle rend en échange le paquet d'un plugin autonome : pas de React à partager, pas de version à
accorder, pas de chaîne de construction commune. L'encart du plugin de référence est un fichier de
JavaScript de module écrit à la main, et il reste lisible.

Les emplacements sont une **liste fermée**. Un emplacement est un contrat — une position dans une
page et un contexte passé au rendu ; laisser un plugin inventer le sien reviendrait à lui laisser
choisir où il s'affiche, et le jour où la page change, rien ne dirait ce qui casse.

Un plugin qui échoue à se charger ou à dessiner ne casse pas la page : il ne dessine rien. Un encart
est un supplément, et le faire tomber avec la page qu'il accompagne donnerait à une extension le
pouvoir de rendre l'application inutilisable.

### Pourquoi les vues existent

Un emplacement sans voie de données ne peut afficher que du texte mort : le cœur ne sait pas lire
les tables du plugin, et le navigateur ne parle pas à PostgreSQL. Une **vue** est une lecture
nommée, appelée par l'encart, exécutée sous le contexte de l'appelant, éventuellement sous un droit
que le manifeste nomme.

Pas de routes libres, pas de verbes d'écriture. Un plugin qui doit écrire le fait depuis un hook, un
événement ou une tâche — c'est-à-dire là où l'on sait quand et pourquoi il écrit. Une route
d'écriture ouverte à l'interface aurait demandé tout un dispositif de validation et de
journalisation que ce jalon n'a pas.

## 7. Désactiver, désinstaller, et l'orphelin

**Désactiver** n'efface rien : les tables et les droits restent, et seuls les hooks, les événements,
les tâches et les emplacements cessent. C'est ce qu'on veut quand un plugin se met à refuser tous
les lancements un lundi matin — couper sans rien perdre, et regarder ensuite.

**Désinstaller** efface : le schéma en entier, les migrations jouées, la ligne du plugin, et les
droits accordés dans les profils. Ce qui reste après n'est plus qu'un dossier sur le disque.

Le module, lui, reste dans le cache de Node — rien ne permet de l'en sortir. Mais plus rien ne
l'appelle.

**Un orphelin** est un plugin installé dont le dossier a disparu. Son schéma, ses droits et sa ligne
sont pourtant toujours là. L'écran le montre comme tel, et permet de le désinstaller pour de bon :
le taire laisserait des tables et des droits derrière un plugin que plus rien ne montre.

## 8. Ce qui reste

- **Les sources d'authentification**, annoncées comme point d'extension dans
  [le périmètre](01-perimetre-fonctionnel.md). Le mécanisme des hooks les porte déjà ; le point
  d'accroche sera ajouté au jalon J9, là où LDAP en fournit une implémentation réelle. L'ajouter ici
  aurait donné un point d'extension que rien n'exerce — or c'est toujours celui qu'on n'a pas
  éprouvé qui casse.
- **La montée de version d'un plugin installé** : les migrations nouvelles se rejouent déjà, mais
  rien ne détecte encore qu'une version plus récente est posée sur le disque.
- **Un ordre de rechargement entre instances** : sur plusieurs instances d'API, installer un plugin
  ne le charge que sur celle qui a reçu la requête. Les autres le prendront à leur prochain
  redémarrage.
