# Contribuer à Flow&

> **A note in English.** The codebase, its comments, its documentation and its commit messages
> are all in **French**, and there is no plan to change that. You will be reading French all
> day. The interface and the emails are bilingual — the project around them is not. Better to
> know before cloning than after.
>
> Bug reports in English are welcome all the same: open an issue, someone will read it.

Merci d'être passé. Le projet est au **jalon J0 sur onze** : le socle tient, rien ne s'exécute
encore. Il n'y a donc pas encore de retour d'usage à donner — mais il y a des décisions à
contester pendant qu'elles se contestent encore.

## Ce qui aide le plus, dans l'ordre

**Discuter l'architecture avant qu'elle ne durcisse.** Les partis pris sont écrits et argumentés
dans [`docs/02-architecture.md`](docs/02-architecture.md), et chacun dit ce que l'outil remplacé
payait à sa place. Le moment de dire qu'un raisonnement est faux, c'est maintenant.

**Signaler ce qui n'est pas clair** dans la documentation. C'est un défaut de documentation et
non un caprice.

**Écrire un bot ou un plugin d'essai**, dès que les SDK existent (jalons J2 et J8). Les deux
resteront en `0.x` tant que chaque point d'extension n'aura pas été exercé par un usage réel ;
l'exemple de référence ne suffit pas à prouver qu'une interface est bonne.

## Avant de coder

Ouvrez une issue d'abord, sauf pour une correction évidente. Le projet a des partis pris
argumentés — le worker séparé, la page Playwright exposée sans façade, le cloisonnement appliqué
par la base, le refus d'un éditeur de flux visuel — et une proposition qui les ignore se heurtera
à un refus qui n'a rien de personnel. Les raisons sont dans [`docs/`](docs/).

## Démarrer

Prérequis : Node 22 ou plus, pnpm 11.

```bash
pnpm install
pnpm --filter @flow/web dev
```

## Les branches

`main` ne reçoit que des versions publiées. On n'y pousse pas — la branche est protégée, et c'est
délibéré : tout ce qui s'y trouve porte une étiquette, si bien qu'un clone de `main` est toujours
quelque chose qu'on peut installer.

```
chantier/…  ──(rebase)──>  develop  ──(coupe)──>  release/0.1.0  ──(fusion)──>  main
```

**Une branche par sujet**, partant de `develop` et fusionnée par _rebase_ : l'historique de
`develop` reste une suite de commits lisibles, sans les allers-retours d'une revue.

**`release/<version>` vers `main` se fusionne avec un commit de fusion**, et c'est la seule
exception au _rebase_. Un _rebase_ réécrirait les commits, et `develop` se retrouverait à porter
des doublons orphelins de ce qui est déjà sur `main`.

## Avant d'ouvrir une pull request

```bash
pnpm format:check
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

L'intégration continue lance exactement cela. Un échec local est un échec distant.

**Écrivez un test qui échoue sans votre correctif.** C'est la seule preuve qu'il corrige quelque
chose. Un test qui passe avant comme après ne démontre rien, et il est plus difficile à repérer
qu'à écrire.

## Conventions

**Les commits sont en français, courts, préfixés d'un gitmoji.**

```
✨ ajoute le registre des bots
🐛 la sonde n'attestait pas que la base répond
```

Le message dit **ce que le commit change**, pas ce que vous avez fait. Le corps sert au
_pourquoi_, quand il n'est pas évident.

**Les commentaires expliquent pourquoi, pas quoi.** Le code dit déjà ce qu'il fait. Un
commentaire qui paraphrase la ligne suivante est du bruit qui vieillit mal ; un commentaire qui
explique le piège évité vaut dix minutes au prochain lecteur. Le dépôt en est plein, et c'est
délibéré.

**Les identifiants sont en anglais sur la surface publique** — contrats, routes d'API, types
exportés — et en français à l'intérieur. Ce qui traverse une frontière se lit par des gens qui
n'écrivent pas français ; ce qui reste dedans se lit par ceux qui maintiennent le code.

**Aucune page n'écrit `dark:`, ni une couleur en dur.** L'interface passe par les jetons
sémantiques, décrits dans [`docs/12-interface.md`](docs/12-interface.md). Un composant qui écrit
`bg-emerald-100` deviendra illisible en thème sombre, et personne ne s'en apercevra avant un
utilisateur.
