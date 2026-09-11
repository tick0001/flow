# Le temps réel

Ce document dit comment une ligne de journal écrite par un bot arrive sur un écran, et — surtout —
ce qui se passe quand le lien se coupe au milieu. C'est là que les protocoles se jugent.

## 1. Le chemin d'un évènement

```
bot ──▶ worker ──Redis pub/sub──▶ API ──SSE──▶ navigateur
          │                        │
          └──── PostgreSQL ────────┘
```

Trois choses voyagent : le **journal**, la **progression** et l'**état**. Une quatrième, les
**images** du navigateur, ne voyage que pendant qu'on regarde.

## 2. Rien n'est diffusé qui ne soit déjà en base

C'est l'invariant du dispositif, et il décide de l'ordre des opérations dans le worker : le journal
et la progression sont publiés **depuis l'écriture**, jamais depuis l'appel du bot.

La raison tient en une phrase : un client qui se reconnecte redemande à la base « ce qui suit le rang
n ». Une ligne diffusée puis perdue avant d'être persistée n'y serait jamais, et disparaîtrait donc
pour de bon — reçue par ceux qui regardaient, invisible pour tous les autres et pour toujours.

Le prix est un retard de deux cents millisecondes, imperceptible à la lecture. Un test le garde : il
interroge la base à la réception de chaque ligne, et tombe quand on inverse les deux.

**Les images font exception**, et c'est leur nature : elles ne sont persistées nulle part, et une
image manquée n'a aucun intérêt à être rattrapée.

## 3. Le choix du transport

**Des évènements diffusés par le serveur, pas un WebSocket.** L'architecture annonçait l'inverse ; le
choix a changé en l'écrivant.

| Ce qu'il faut          | SSE                               | WebSocket                         |
| ---------------------- | --------------------------------- | --------------------------------- |
| Sens du trafic         | Descendant, ce qui suffit ici     | Bidirectionnel, moitié inutilisée |
| Reprise après coupure  | Dans le protocole                 | À écrire des deux côtés           |
| Authentification       | Le cookie, les gardes, les droits | Une seconde voie à écrire         |
| Connexions par origine | Une des six en HTTP/1.1           | Hors quota                        |

Le seul geste montant serait « je regarde cette exécution-ci », que l'URL dit déjà. Et la reprise est
précisément le critère de sortie de ce jalon : l'obtenir gratuitement plutôt que l'écrire des deux
côtés a emporté la décision.

La limite des six connexions disparaît en HTTP/2, que sert n'importe quel relais inverse. Le jour où
un geste montant apparaîtra — piloter le navigateur depuis la vue en direct, par exemple — c'est ce
jour-là qu'il faudra rouvrir la question, pas avant.

## 4. La reprise : deux déclencheurs, un seul mécanisme

`EventSource` reconnecte de lui-même et renvoie `Last-Event-ID`, le rang de la dernière ligne reçue.
Le serveur rejoue ce qui suit. Rien à écrire.

**Sauf qu'il abandonne définitivement** dès qu'une tentative reçoit une erreur HTTP — ce qui arrive
exactement quand l'API redémarre, le relais répondant alors 502. Le navigateur ferme, cesse
d'essayer, et la page se fige sans rien dire. C'est le cas qu'on trouve en coupant pour de vrai,
jamais en lisant la documentation du protocole.

Le client rouvre donc lui-même dans ce cas, avec recul progressif, en passant le rang dans la
requête — une connexion neuve n'a pas d'histoire, et le navigateur n'y met aucun `Last-Event-ID`. Les
deux chemins reprennent au même endroit, et le serveur accepte le rang des deux provenances en
gardant le plus avancé.

## 5. Le journal est un flux, l'état est un instantané

La distinction porte tout le reste.

Le **journal** s'ajoute, chaque ligne porte son rang, et seule une ligne porte un identifiant
d'évènement — c'est ce rang qui sert de point de reprise.

L'**état** s'écrase : il est renvoyé en entier à chaque changement, relu sous le contexte de _ce_
lecteur-là. Le worker ne peut pas le calculer, puisqu'il ne sait ni qui regarde, ni ce que chacun a
le droit d'interrompre. C'est aussi ce qui évite au client une requête de détail supplémentaire à
chaque transition.

### L'ordre d'ouverture dépend de l'état

Le client ferme dès qu'il voit un état terminal — il le doit, sinon le navigateur rouvrirait sans fin
le flux d'une exécution qui n'émettra plus rien.

Conséquence : sur une exécution **déjà terminée**, l'instantané doit partir **après** le rappel du
journal. Envoyé en premier, il faisait raccrocher le client avant les lignes, et l'écran restait
vide. Sur une exécution en cours, c'est l'inverse : l'instantané part d'abord, pour que la page
apparaisse sans attendre que des milliers de lignes aient défilé.

## 6. L'abonnement suit les lecteurs

Un canal Redis par exécution. La première personne qui ouvre une exécution ouvre l'abonnement, la
dernière qui part le ferme.

Un canal global aurait été plus court à écrire et aurait fait recevoir à chaque instance d'API tout
ce que produit l'installation — images comprises — pour en jeter presque tout.

## 7. Les images, seulement pendant qu'on regarde

L'API publie le **compte des lecteurs** d'une exécution, et le répète tant qu'ils sont là. Le worker
ouvre le screencast au premier, le ferme au dernier — et aussi quand le signal se tait, ce qui
rattrape une instance d'API morte pendant qu'un lecteur regardait.

Encoder des images que personne ne reçoit prendrait du processeur sur l'exécution elle-même. C'est
exactement ce que faisait l'outil remplacé, qui poussait une capture PNG toutes les 800 ms à chaque
session ouverte, qu'on regarde ou non — et qui, entre deux prises, manquait ce qui se passait.

Le screencast CDP inverse la logique : **le navigateur produit les images lui-même**, à la cadence
des changements d'écran. Une page immobile ne produit rien, une page qui défile produit ce qu'il
faut. Chaque image doit être **acquittée**, sans quoi Chromium cesse d'en envoyer après
quelques-unes — panne silencieuse, à vérifier en premier si la vue se fige.

## 8. Ce que le flux vérifie pendant qu'il vit

Un battement toutes les quinze secondes, qui fait trois choses :

- **il tient la connexion ouverte.** Une exécution peut ne rien produire pendant des minutes, et un
  relais inverse ferme un flux silencieux sans rien dire ;
- **il revalide la session.** Un flux vit bien plus longtemps qu'une requête : sans cela, une session
  fermée ou un compte désactivé pendant qu'on regarde continueraient de recevoir jusqu'à la fin de
  l'exécution ;
- **il relit l'état.** Un état terminal se sait normalement par un évènement — mais un worker tué n'en
  publie aucun, et une diffusion peut se perdre. Cette relecture ferme tous les cas restants.

Le dernier point énonce une règle qui vaut au-delà de ce fichier : **l'écran ne doit jamais
contredire la base durablement.**

L'évènement de battement porte un _type_, ce qui le rend invisible : le navigateur ne passe un
évènement typé qu'à un écouteur du même nom, jamais au `onmessage` ordinaire. Le flux reste donc
ouvert sans qu'une ligne de code cliente ait à l'ignorer, et sans élargir le contrat des évènements.

## 9. Ce qui reste à faire

**La liste des exécutions** relit toutes les deux secondes tant qu'une de ses lignes bouge, et
s'arrête sinon. La rendre vive demanderait un canal par périmètre d'entités, ou un canal global
filtré : deux fois plus de mécanique pour un écran qu'on regarde rarement pendant qu'il change.

**Les images ne sont pas enregistrées.** La vue en direct est un miroir, pas un magnétoscope ; rejouer
une exécution passée demanderait un stockage vidéo, ce qui est un autre produit. La capture d'échec,
elle, arrive au jalon J5.
