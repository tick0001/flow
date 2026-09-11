# Le cycle de vie d'une exécution

Ce document dit ce qui se passe entre le clic sur « Lancer » et la ligne finale de la trace — et
surtout ce qui se passe quand **quelque chose se casse au milieu**, puisque c'est là que les choix
se paient.

## 1. Trois processus, une seule vérité

```
Interface ──HTTP──▶ API ──BullMQ──▶ Worker ──Playwright──▶ Chromium
                     │                 │
                     └──── PostgreSQL ─┘
```

**L'état vit en base. La file ne porte que l'intention de faire.**

C'est la règle dont tout le reste découle. Un vidage de Redis ne perd donc aucun historique, un
redémarrage de l'API ne perd pas une exécution en cours, et plusieurs workers travaillent sans se
concerter — ils ne partagent que la base.

L'alternative — un état porté par la file — aurait été plus simple à écrire et se serait effondrée
au premier incident : c'est exactement ce que faisait l'outil remplacé, où une exécution était un
`Task.Run` dans le process web, disparue avec lui.

## 2. Les six états

| État        | Ce qu'il dit                                                  |
| ----------- | ------------------------------------------------------------- |
| `queued`    | En file. Personne ne l'a encore prise.                        |
| `running`   | Un worker la détient, et le prouve par son battement de cœur. |
| `succeeded` | Le bot a rendu la main sans lever d'exception.                |
| `failed`    | Le bot a échoué, ou ses paramètres ont été refusés.           |
| `cancelled` | **Quelqu'un** l'a interrompue.                                |
| `abandoned` | **Plus personne** ne la détenait.                             |

Les deux derniers sont distingués, et c'est délibéré. Les confondre effacerait la seule trace d'une
panne d'infrastructure, et enverrait chercher un utilisateur capricieux là où il faut lire les
journaux du conteneur.

`queued` couvre aussi bien l'attente d'un créneau que l'attente d'un worker : de l'extérieur c'est
la même chose, et distinguer les deux obligerait à publier un état que rien ne sait observer de
façon fiable.

## 3. Le chemin normal

1. **L'API valide les paramètres** contre le JSON Schema du manifeste, avant toute écriture. Un
   paramètre fautif est un refus immédiat, sur le champ, dans le formulaire — et non une trace en
   échec trente secondes plus tard.
2. **L'API écrit la ligne**, puis publie le travail. _L'ordre n'est pas interchangeable_ : publier
   d'abord ouvrirait une fenêtre pendant laquelle un worker dépile un travail dont la ligne n'est pas
   encore visible, et le jetterait. Dans ce sens-ci, le pire cas est une ligne `queued` sans travail
   — que la réconciliation remet en file.
3. **Le worker réclame** : `UPDATE ... SET status = 'running' WHERE status = 'queued'`. La condition
   fait tout le travail (voir §5).
4. **Il reconstitue le contexte** depuis la trace — compte, profil, entité — et écrit sous lui, avec
   le rôle applicatif soumis au Row-Level Security. Écrire avec le rôle propriétaire aurait été plus
   court et aurait privé les journaux du cloisonnement que tout le reste respecte.
5. **Il ouvre un contexte navigateur isolé**, revalide les paramètres avec le schéma Zod de l'auteur
   — la validation qui fait foi — et lance le bot.
6. **Il pose un dénouement.** Toujours, quoi qu'il arrive. Une exécution sans dénouement reste
   `running` pour l'éternité, et c'est l'état que personne ne sait interpréter.

## 4. Ce que le bot reçoit, et ce qui l'observe

Le journal est **persisté au fil de l'eau**, par paquets de deux cents millisecondes. Une insertion
par ligne serait intenable pour un bot qui journalise en boucle ; accumuler jusqu'à la fin ferait
qu'une exécution d'une heure interrompue par un incident laisserait un historique vide — ce que
faisait l'outil remplacé.

Le rang de chaque ligne est attribué **à l'appel**, pas à l'écriture. Deux lignes émises dans la même
milliseconde s'afficheraient sinon dans un ordre arbitraire, et la reprise après coupure n'aurait
aucun point fixe. Le worker étant à tout instant le seul écrivain d'une exécution, le compteur vit
en mémoire — une séquence PostgreSQL aurait été globale à la table, donc trouée et sans signification
à l'intérieur d'une exécution.

La progression est un **état qu'on écrase**, pas un historique qu'on empile : seule la dernière
valeur compte, et l'historique des étapes, c'est le journal.

## 5. L'interruption traverse deux process

Elle ne peut donc plus être un jeton d'annulation en mémoire.

**L'intention est écrite en base, puis diffusée.** La diffusion Redis est le chemin _rapide_ ; la
lecture au battement de cœur suivant est le chemin _fiable_. Un worker qui redémarre relit la
colonne ; un worker qui n'écoutait pas au bon moment voit la demande un battement plus tard. Faire
porter l'annulation par la seule diffusion l'aurait rendue perdable.

Côté worker, **deux gestes et non un** :

- le signal d'abandon, que le bot consulte entre deux étapes ;
- **la fermeture du contexte navigateur**, qui est ce qui arrête réellement un bot suspendu dans un
  `waitForSelector`. Playwright n'écoute aucun `AbortSignal`.

Le test le vérifie par le délai et non par le libellé : sans la fermeture, les trois tests
d'interruption expirent à deux minutes au lieu de finir en cinq secondes — tout en concluant
« interrompue ». Une assertion sur le seul statut aurait donc passé en mentant.

### La course entre annuler et démarrer

Une mise à jour conditionnelle arbitre, et il n'y a pas d'autre arbitre :

```sql
-- l'API, pour annuler une exécution qui n'a pas démarré
UPDATE executions SET status = 'cancelled' WHERE id = ? AND status = 'queued';

-- le worker, pour la réclamer
UPDATE executions SET status = 'running'   WHERE id = ? AND status = 'queued';
```

L'un des deux trouve une ligne, l'autre n'en trouve aucune. Comparer l'état puis agir en deux temps
aurait laissé les deux gagner.

Cette même condition ferme une troisième porte : **BullMQ redistribue de lui-même un travail dont le
verrou a expiré**, ce qui arrive quand un worker meurt. La réclamation échoue alors — l'exécution est
encore `running` — et le bot ne tourne pas deux fois. Cela compte : un bot remplit des formulaires et
clique sur des boutons, le rejouer referait ce qui avait déjà abouti. C'est aussi pourquoi la file
est configurée sans aucune reprise automatique : **reprendre est une décision humaine**.

## 6. Ce qui rattrape le reste

Un balayage tourne dans l'API, toutes les quinze secondes.

**Les orphelines.** Un worker tué ne vient pas dire qu'il est parti. Passé quatre battements de cœur
manqués — une minute — son exécution est déclarée `abandoned`, avec sa durée réelle et l'identifiant
du worker conservé : c'est la première question quand un échec ne se reproduit que sur une machine.
Quatre battements et non un : un seul saute sur une pause du ramasse-miettes, et déclarer abandonnée
une exécution qui allait aboutir est bien pire que d'attendre une minute.

**La réconciliation.** La base porte la vérité, la file n'en est qu'un reflet. Une exécution `queued`
dont le travail a disparu y retourne — l'identifiant du travail étant celui de l'exécution,
l'opération est idempotente et ne peut pas créer de doublon. C'est ce qui rend un vidage de Redis
réparable, là où il aurait autrement fallu relancer chaque exécution à la main sans savoir
lesquelles.

**Dans l'API et non dans le worker**, alors que le worker est plus proche du sujet : une installation
sans worker vivant est exactement le moment où tout est orphelin, et celui où personne ne
balaierait.

**La durée maximale d'une exécution** est le seul garde-fou que le balayage ne fournit pas : un bot
bouclé sans fin garde un navigateur et une place de concurrence, et son worker bat le cœur pour lui
en toute bonne foi. Elle est donc réglée dans le worker, et dépassée vaut `failed` — personne n'a
rien demandé.

## 7. Le réglage du battement

La période du battement et le délai au-delà duquel une exécution est orpheline vivent **dans les
contrats partagés**, et le second dérive du premier.

Deux variables d'environnement, une dans le worker et une dans l'API, auraient fini par se
contredire sur une installation : un délai plus court que la période ferait déclarer orphelines
toutes les exécutions, en permanence, sans qu'aucun journal ne dise pourquoi.

## 8. Ce que ce jalon ne fait pas

**Le temps réel.** L'interface relit périodiquement : une seconde pour le journal, deux pour la
liste, et elle s'arrête dès que tout est terminé. La diffusion par WebSocket arrive au jalon J4 — et
le point de reprise par rang qu'utilise déjà le client est exactement ce dont elle aura besoin pour
rattraper une coupure. Rien à jeter.

**Le quota d'exécutions simultanées par entité.** La colonne existe depuis le jalon J1 et n'est
encore lue par personne. La faire respecter demande une file par entité, ou un gardien qui compte
avant de dépiler ; l'écrire à moitié donnerait un réglage qui semble protéger et ne protège pas.

**Le versement des fichiers produits.** Un bot reçoit un dossier de sortie ; ce qu'il y écrit reste
sur la machine du worker jusqu'au jalon J5. Le dossier est retiré s'il est resté vide, ce qui est le
cas de la plupart des runs.

**Le droit par bot.** `bot:execute` est global au profil : qui peut lancer peut lancer n'importe
lequel. Le modèle mérite d'être conçu — par profil ? par entité ? — plutôt que bricolé.
