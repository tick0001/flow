# Interface

Ce document décrit les décisions d'apparence : les jetons de couleur, la coquille de navigation et
les briques communes. Il existe parce que ces choix se prennent une fois et se subissent longtemps.

Flow& appartient à la collection **tick&** et en reprend l'écriture visuelle. Ce qui suit dit donc
autant ce qui est **commun** — et doit le rester — que ce qui est **propre** à Flow&.

## 1. Ce que la collection impose

L'écriture est celle de l'atelier : papier, encre, filets. Trois partis pris, et chacun s'oppose à
ce que produisent les bibliothèques par défaut.

**Le fond est du papier, pas du gris écran.** Un gris froid neutre est le réglage par défaut de tout
le monde ; un blanc cassé chaud donne une assise à la page et repose l'œil sur huit heures. Les
neutres sont chauds, jamais bleutés.

**Aucune ombre floue.** La séparation se fait au filet d'un pixel, comme sur un plan technique.
L'ombre portée douce est la signature de l'époque : elle rend tout flottant, et rien n'a de bord.

**Une seule couleur de signal, rare.** Elle ne sert qu'à ce sur quoi on agit. Une interface où trois
couleurs se disputent l'attention n'en dirige aucune.

S'y ajoutent la géométrie presque droite — toute l'échelle de rayons ramenée à deux ou trois pixels,
`rounded-full` excepté pour les pastilles —, Archivo en variable, les chiffres tabulaires dans les
tableaux, et l'anneau de focus déclaré une seule fois sur le document.

## 2. Ce qui est propre à Flow&

**La couleur de marque, et elle seule.** Violet encre `#4c3d99` en clair, `#8b7ce0` en sombre. Tout
le reste — neutres, géométrie, ombres, jetons de sens — est identique à Tick&, et c'est ce qui fait
qu'on reconnaît deux outils de la même famille.

Le violet n'a pas été choisi pour son élégance mais par **élimination**. Les jetons de sens occupent
déjà le bleu (`info`), le vert (`positive`), l'ocre (`caution`) et le rouge (`critical`) : une marque
dans l'une de ces familles aurait fait ressembler un badge d'information à un bouton d'action. Le
violet ne croise aucun d'eux.

Le jeton sombre n'est pas le violet clair éclairci mécaniquement : `#4c3d99` sur `#14120e` tombe
sous le contraste lisible d'un texte. Il est choisi pour tenir sur ce fond-là.

**Le journal d'exécution est le seul endroit qui appelle une écriture de terminal**, et il la
mérite : c'est du texte machine, horodaté, dense, que l'on parcourt en cherchant une ligne. Fond
enfoncé plutôt que surface, chasse fixe, horodatage en retrait pour qu'il serve de repère sans se
lire. Partout ailleurs, l'interface reste du papier.

## 3. Jetons sémantiques

Les couleurs sont des propriétés personnalisées, exposées à Tailwind par `@theme inline`.
L'utilitaire pointe alors **directement** sur la propriété : `.bg-surface` devient
`background-color: var(--flow-surface)`. Le thème sombre n'a plus qu'à redéfinir ces propriétés.

Aucune page n'écrit `dark:`. C'est la propriété la plus importante du dispositif : une couleur ne
peut plus diverger entre deux écrans parce qu'on a oublié sa variante — la variante n'existe plus.

Les noms disent le **rôle**, pas la teinte :

| Famille | Jetons                                                        | Usage                              |
| ------- | ------------------------------------------------------------- | ---------------------------------- |
| Fonds   | `canvas`, `surface`, `sunken`, `raised`                       | du plus reculé au plus avancé      |
| Traits  | `line`, `line-strong`                                         | bordure ordinaire, bordure appuyée |
| Textes  | `ink`, `muted`, `faint`                                       | du plus lisible au plus discret    |
| Marque  | `brand`, `brand-hover`, `brand-soft`, `brand-ink`, `on-brand` | actions et éléments actifs         |
| Sens    | `positive`, `caution`, `critical`, `info` (+ `-soft`, `-ink`) | états et alertes                   |

`surface` reste `surface` le jour où le fond passe du blanc au gris ; `bg-white` aurait menti dès la
première retouche.

### Trois états de thème, pas deux

`clair`, `sombre`, `système`. Le troisième **retire** l'attribut `data-theme` au lieu d'en poser un
autre : la feuille de style bascule alors sur `prefers-color-scheme`, et l'interface suit le réglage
du poste sans qu'on ait à l'observer nous-mêmes. Poser `data-theme="system"` figerait l'écran sur la
palette claire, puisque aucune règle ne correspond à cette valeur — un test l'épingle.

Le choix est mémorisé sur le poste, pas sur le compte : c'est une préférence liée à l'écran devant
lequel on se trouve.

## 4. Les états d'exécution

Six statuts, cinq tons, et le violet n'en est pas.

| Statut      | Ton       | Pourquoi                                              |
| ----------- | --------- | ----------------------------------------------------- |
| `queued`    | neutre    | On attend. Rien à signaler.                           |
| `running`   | info      | En cours, sans verdict.                               |
| `succeeded` | positif   | —                                                     |
| `failed`    | critique  | Le bot a échoué : on lira son journal.                |
| `cancelled` | neutre    | Quelqu'un a décidé. Ce n'est pas une alerte.          |
| `abandoned` | attention | L'infrastructure a lâché : on lira d'autres journaux. |

Deux décisions s'y jouent. **Le violet ne sert pas à un état** : il ne qualifie que ce sur quoi on
agit, et l'y dépenser affaiblirait le seul signal de l'interface. **`failed` et `abandoned` ne
partagent pas leur ton** alors que les deux disent « ça n'a pas marché » : ce ne sont pas les mêmes
journaux qu'on va lire, et les confondre visuellement effacerait la distinction que le modèle de
données prend soin de faire.

`queued` et `cancelled` partagent le neutre, et c'est assumé : ni l'un ni l'autre n'est une alerte,
et le mot suffit à les distinguer.

**La pastille, jamais l'aplat plein.** Sur une liste de quarante exécutions, quarante aplats colorés
se neutralisent — l'écran devient un damier et plus rien ne ressort. Le point porte la couleur, le
mot porte le sens, le fond reste du papier.

## 5. Briques communes

`components/ui/primitives.tsx` : `Button`, `LinkButton`, `Input`, `Select`, `Textarea`, `Checkbox`,
`Field`, `Card`, `CardHeader`, `CardBody`, `PageHeader`, `SectionTitle`, `Badge`, `Pastille`,
`Notice`, `EmptyState`, `TableWrap`, `Marque`.

Les classes sont **aussi** exportées comme chaînes (`CONTROLE`, `BOUTON`, `BOUTON_PRIMAIRE`,
`CARTE`). Quelques formulaires composent leurs contrôles dans des boucles denses ; leur imposer un
composant aurait ajouté une enveloppe sans rien gagner. Ils partagent au moins les mêmes classes.

### Ce que les composants décident

- **L'action principale d'un écran est pleine et colorée**, les autres sont en retrait.
- **`Badge` qualifie, `Pastille` dit un état.** Les confondre reviendrait à donner le même poids à
  « v1.2.0 » et à « en échec ».
- **Le champ ne colore pas sa bordure au focus.** L'anneau violet posé sur le document s'en charge ;
  doubler le signal en ferait deux, dont aucun ne porte.
- **`EmptyState` dit pourquoi c'est vide.** « Aucun résultat » seul laisse le lecteur se demander
  s'il a mal filtré ou si l'outil est cassé.
- **Le défilement horizontal appartient au tableau, jamais à la page.** Un écran dont le corps
  entier glisse latéralement fait disparaître la navigation.

### Le nuancier

`pages/Nuancier.tsx` montre les jetons et les briques à l'écran, dans les deux thèmes. Une palette
décrite dans un fichier CSS ne se juge pas : cette page est le contrôle visuel de chaque retouche,
et c'est elle qui a fait voir que le violet servait à tort de ton de statut.

## 6. Icônes

Écrites dans le dépôt plutôt qu'importées. Une bibliothèque d'icônes embarque plusieurs milliers de
tracés pour la vingtaine dont cette interface a besoin, et impose son propre rythme de mise à jour.

Le style est uniforme — trait de 1,5, extrémités arrondies, grille de 24 — parce que c'est ce qui
fait qu'un jeu d'icônes tient ensemble, bien plus que le nombre de tracés.

## 7. Ce que les extensions doivent savoir

Les jetons sont à leur disposition : un plugin qui écrit `bg-positive-soft` suivra le thème, un
plugin qui écrit `bg-emerald-100` deviendra illisible en sombre.

Les dossiers `plugins/` et `bots/` sont déclarés comme sources Tailwind (`@source`) : sans cela, les
classes d'une extension ne seraient jamais générées, et son écran sortirait sans aucun style — une
panne que son auteur mettrait longtemps à relier à sa cause.
