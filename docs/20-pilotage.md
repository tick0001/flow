# Le pilotage

Ce document dit comment deux cents messages d'échec deviennent trois causes, pourquoi les chiffres
de tête sont ceux-là et pas d'autres, et ce qu'un export doit à celui qui l'ouvrira.

L'écran répond à une question et une seule : **qu'est-ce qui casse le plus souvent, et depuis
quand**. Tout ce qui est au-dessus du tableau des causes — le taux, les durées, la tendance — sert à
savoir s'il faut se la poser.

## 1. La signature

C'est la pièce centrale.

Un message d'échec ne se répète presque jamais à l'identique. Il porte une adresse, un délai, un
identifiant, un sélecteur :

```
page.goto: Timeout 30000ms exceeded. Call log: - navigating to "https://intranet/connexion"
page.goto: Timeout 45000ms exceeded. Call log: - navigating to "https://intranet/tableau"
```

Deux lignes, une seule panne. Groupés tels quels, deux cents échecs donnent deux cents lignes
uniques où l'on ne voit rien — alors qu'il n'y a souvent que trois causes.

La signature est le message débarrassé de ce qui varie. Elle remplace, dans cet ordre :

| Ce qui varie          | Devient     |
| --------------------- | ----------- |
| un UUID               | `<id>`      |
| une adresse           | `<adresse>` |
| une valeur citée      | `<valeur>`  |
| un nombre             | `<n>`       |
| des espaces multiples | un espace   |

### L'ordre compte

Les formes les plus spécifiques d'abord. Remplacer les nombres avant les identifiants transformerait
un UUID en une bouillie de tirets et de jetons, et deux identifiants de formes différentes
cesseraient de se ressembler.

### La frontière de mot qui manquait

Une première version exigeait une frontière de mot autour des nombres — `\m[0-9]+\M` en syntaxe
PostgreSQL. Elle ne marchait pas, et elle ne marchait pas sur le cas le plus fréquent de tous :

```
 2 | page.goto: Timeout 30000ms exceeded. …
 2 | page.goto: Timeout 45000ms exceeded. …
```

Un chiffre collé à son unité n'a pas de frontière après lui : entre `0` et `m`, il n'y a pas de
limite de mot. Deux délais d'attente de durées différentes restaient donc deux causes, c'est-à-dire
exactement la fragmentation que la signature existe pour éviter.

La règle ne demande plus de frontière. Les identifiants et les adresses étant déjà remplacés à ce
stade, il ne reste rien qu'un chiffre nu puisse abîmer. `signature.integration.test.ts` le vérifie
contre une vraie base, et échoue si on rétablit la frontière.

### Un regroupement par cause, pas par cause et par bot

Une première version groupait par signature **et** par bot. Le même délai d'attente apparaissait
alors une fois par bot :

```
12 fois  Bonjour   page.goto: Timeout <n>ms exceeded …
 5 fois  Bavard    page.goto: Timeout <n>ms exceeded …
```

C'est la fragmentation de tout à l'heure, réintroduite un cran plus loin : avec dix bots, une seule
panne aurait rempli la liste. Le compte porte donc sur la cause — `17 fois` — et les bots touchés
l'accompagnent au lieu de la découper. Le tableau « par bot », plus bas dans l'écran, est l'endroit
où l'on regarde un bot.

### Calculée à la lecture

Une colonne générée serait plus rapide. Elle demanderait une migration et un remplissage à chaque
fois qu'on affine la règle — or on l'affinera : les messages viennent de bibliothèques qu'on ne
contrôle pas. La période est bornée et l'index sur l'entité et la date fait le gros du tri. Le jour
où cela ne suffira plus, une colonne générée prendra le relais sans que rien d'autre ne bouge.

## 2. Les chiffres de tête

**La médiane, pas la moyenne.** Une exécution qui part en délai d'attente de trente secondes tire
une moyenne bien au-delà de ce que vivent les autres, et « la durée habituelle » cesse de vouloir
dire quoi que ce soit. Le quatre-vingt-quinzième centile dit ce qui reste, c'est-à-dire les cas
lents.

**Le taux ne porte que sur les exécutions terminées.** Compter les exécutions en cours comme des
échecs ferait plonger le taux à chaque rafale de lancements ; les compter comme des réussites le
ferait mentir dans l'autre sens.

**Rien de terminé donne `null`, pas zéro.** Un taux calculé sur zéro exécution est un chiffre
inventé, et « 0 % » se lit comme une panne.

**Un seul chiffre est coloré.** Si les quatre l'étaient, aucun ne dirait plus rien. Le taux de
réussite est le seul qu'on lit comme un jugement.

## 3. La tendance

Dessinée à la main, sans bibliothèque de graphiques. Une bibliothèque apporterait des dégradés, des
ombres portées, des animations d'entrée et une infobulle flottante — le contraire de l'écriture de
cette application, où rien ne flotte et où un filet vaut mieux qu'une ombre. Il faudrait ensuite
passer du temps à lui retirer ce qu'elle apporte. Ce qu'il y a ici tient en cinquante lignes de
rectangles et de filets. Le jour où il faudra un nuage de points ou une double échelle, la question
se reposera.

Les barres sont **empilées et non côte à côte** : ce qu'on lit d'abord est la hauteur totale, et la
part rouge se voit dans la foulée. Deux barres jumelles demanderaient de comparer deux hauteurs pour
répondre à la même question.

Les jours sans exécution y figurent, à zéro — un `generate_series` les produit. Sans eux, un arrêt
de trois jours se lirait comme une activité continue.

Les graduations vivent dans une gouttière à gauche, et le tracé garde de l'air au-dessus du maximum.
L'étiquette d'une graduation se dessine au-dessus de son filet : celle du maximum tombait donc hors
du cadre, et le dessin perdait la seule graduation qui donne son échelle. Rien ne le signalait — un
dépassement de `viewBox` n'échoue pas, il efface.

## 4. L'export

**Une marque d'ordre des octets en tête.** Sans elle, Excel lit un CSV en UTF-8 comme s'il était
dans l'encodage de la machine, et « Réussie » devient « RÃ©ussie ». Les autres tableurs l'ignorent.

**Un plafond, et il se dit.** Cinquante mille lignes tiennent dans un tableur. Au-delà, ce qu'on
cherche n'est plus un export mais une requête. Un export silencieusement tronqué est pire qu'un
export refusé : on ouvre le fichier, on compte, et l'on conclut que le mois a été calme. L'appelant
reçoit donc l'en-tête `X-Flow-Tronque`, et la dernière ligne du fichier le répète — parce que
l'en-tête se perd dans un navigateur.

**Les formules sont neutralisées.** Un tableur traite une cellule commençant par `=`, `+`, `-` ou
`@` comme une formule et l'évalue à l'ouverture ; certaines atteignent le réseau ou le système de
fichiers. Or la colonne des messages porte du texte lu sur les pages que le bot a visitées,
c'est-à-dire du texte que quelqu'un d'autre écrit, et un export est ce qu'on ouvre sans y penser sur
un poste d'exploitation. Ces cellules sont donc citées et préfixées d'une apostrophe, que le tableur
mange en affichant le texte tel quel.

Les nombres, eux, passent intacts : le tiret d'un nombre négatif n'est pas une formule, et le
préfixer en ferait du texte que plus personne ne saurait additionner.

## 5. Un droit à part

`stats:read`, et non `execution:read`. Un tableau de bord montre des taux et des durées, pas le
détail d'une exécution. Les séparer permet de donner les chiffres à qui pilote sans lui ouvrir les
journaux — qui contiennent, eux, ce qu'un bot a lu sur les pages qu'il a visitées.

Le cloisonnement reste celui de toute l'application : les politiques RLS sur `executions` bornent ce
que la requête voit, l'entité active et la case « inclure les sous-entités » bornent le reste. Le
droit n'élargit rien ; il ouvre ou ferme l'écran.

Ce droit n'existait pas avant ce jalon. Une installation déjà en service ne l'accorde donc à
personne tant que quelqu'un ne va pas le cocher dans le profil : l'initialisation, qui donne tout le
catalogue au profil d'administration, refuse de s'exécuter sur une base peuplée.

## 6. Ce qui reste

- Comparer une période à la précédente — « deux fois plus d'échecs que le mois dernier » est une
  phrase que cet écran ne sait pas encore dire.
- Une alerte quand une cause nouvelle apparaît, plutôt qu'un écran qu'il faut penser à ouvrir.
- Une commande qui aligne les droits d'un profil sur le catalogue après une montée de version.
