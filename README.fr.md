[English](README.md) · **Français**

# Flow&

**Automatisation navigateur open source, auto-hébergée.** Des bots écrits en TypeScript, exécutés
pour le compte de plusieurs personnes, avec le journal, la progression et la vue en direct de ce
qu'ils font — plus une trace de ce qui s'est passé quand ils cassent.

[![Licence](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)

Membre de la collection **tick&**, aux côtés de [Tick&](https://tickand.fr), outil de ticketing
ITSM, dont Flow& reprend la pile technique, les conventions et l'écriture visuelle.

---

## Où en est le projet

**Jalon J5 sur onze. Un échec se diagnostique à l'écran.** On dépose un dossier de bot, on le lance
depuis l'interface avec un formulaire déduit de son schéma, et il tourne dans un worker séparé qui
pilote Chromium. Le journal, la progression et la **vue en direct du navigateur** arrivent poussés
par le serveur. Quand ça casse, la **capture au moment de l'échec** et la **trace Playwright** sont
sur la page, avec le journal filtrable — sans ouvrir un terminal.

Avant lui : l'arbre des entités, le Row-Level Security de PostgreSQL, les sessions, les droits,
l'administration des comptes, les deux langues, le SDK de bots, l'exécution dans un worker séparé et
le temps réel.

**Il n'y a pas encore** de planification, ni de clés d'API, ni de tableaux de bord.

Ce qui est déjà décidé et argumenté vit dans [`docs/`](docs/) :
[périmètre](docs/01-perimetre-fonctionnel.md), [architecture](docs/02-architecture.md),
[entités, droits et sécurité](docs/03-entites-droits-securite.md),
[SDK de bots](docs/15-sdk-bots.md), [cycle d'une exécution](docs/16-cycle-d-execution.md),
[temps réel](docs/17-temps-reel.md), [historique et stockage](docs/18-historique-et-stockage.md),
[interface](docs/12-interface.md), [feuille de route](docs/06-feuille-de-route.md).

Le cloisonnement entre organisations est prouvé par des tests d'intégration contre une vraie base
PostgreSQL : ils échouent tous quand on les pointe sur le rôle propriétaire, et c'est ce qui leur
donne une valeur. L'interruption est éprouvée de la même façon, contre un vrai navigateur : les
tests expirent à deux minutes si l'on retire la fermeture du contexte, au lieu de finir en cinq
secondes. Et la diffusion temps réel est vérifiée en interrogeant la base à la réception de chaque
ligne — rien n'est diffusé qui ne soit déjà écrit. La [feuille de route](docs/06-feuille-de-route.md) dit dans quel ordre la suite arrive et
à quoi se reconnaît chaque étape terminée.

## Ce que ce sera

**Un bot est du code.** Des métadonnées, un schéma de paramètres Zod, et une fonction qui reçoit une
page Playwright authentique — pas une façade appauvrie. Le formulaire de lancement est déduit du
schéma, si bien que le serveur valide exactement ce que l'interface a affiché.

**Les navigateurs tournent dans un worker séparé.** L'API n'en lance jamais un : elle crée la trace,
publie le travail, rend la main. Un Chromium qui meurt n'emporte plus l'interface, un redémarrage ne
perd plus une exécution, et la charge s'encaisse en ajoutant des workers.

**On voit ce qui se passe.** Journal horodaté persisté au fil de l'eau, progression, et vue en
direct du navigateur par screencast CDP — relayée aux seuls abonnés, pas poussée dans
un circuit permanent par utilisateur.

**Multi-organisation, appliqué par la base.** Les entités forment un arbre et l'isolation repose sur
la Row-Level Security de PostgreSQL — pas sur des clauses `WHERE` qu'on peut oublier d'écrire.

**Extensible sans forker.** Deux SDK, parce que ce sont deux publics : `@flow/bot-sdk` pour écrire
un bot, `@flow/plugin-sdk` pour étendre l'application elle-même.

## Essayer localement

Prérequis : Node 22 ou plus, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up      # PostgreSQL et Redis, sur des ports décalés
pnpm db:migrate       # schéma, déclencheurs, politiques RLS
pnpm navigateurs      # Chromium, pour le worker — une seule fois
FLOW_ADMIN_PASSWORD="choisissez-en-un-vrai" pnpm db:init
pnpm dev              # API :3100, interface :5273, worker
```

Puis <http://localhost:5273>. La première connexion impose un changement de mot de passe.

Un bot de référence est déjà déposé dans [`bots/`](bots/exemple-bonjour) : construisez-le
(`pnpm build`), ouvrez **Bots**, et lancez-le sur une adresse de votre choix.

Le worker installe ses navigateurs à part, et jamais au démarrage : une application qui télécharge
Chromium au premier lancement transforme une panne de proxy d'entreprise en application qui ne
démarre pas.

Les ports sont décalés — 5433, 6380, 3100, 5273 — pour que Flow& et les autres projets de la
collection tournent côte à côte.

## Développer

```bash
pnpm build       # construit tous les paquets
pnpm test        # la suite de tests
pnpm lint        # ESLint avec les règles typées
pnpm typecheck   # vérification des types, sans émission
pnpm format      # applique Prettier
```

L'intégration continue lance exactement cela. Un échec local est un échec distant.

## Décisions techniques

| Sujet              | Décision                                                      |
| ------------------ | ------------------------------------------------------------- |
| Backend            | NestJS (TypeScript)                                           |
| Exécution          | Worker séparé, Playwright, file BullMQ sur Redis              |
| Base de données    | PostgreSQL — `ltree`, `jsonb`, `tsvector`, Row-Level Security |
| Accès aux données  | Drizzle ORM, schéma découpé par module                        |
| Frontend           | React + Vite, Tailwind, TanStack Query & Table                |
| Temps réel         | Redis pub/sub relayé en SSE, screencast CDP                   |
| Extensions         | Modules ESM, manifeste versionné, deux SDK en semver propre   |
| Multi-organisation | Entités hiérarchiques + Row-Level Security PostgreSQL         |
| Déploiement        | Auto-hébergé, Docker Compose, et hors conteneurs              |
| Authentification   | Locale + LDAP / Active Directory                              |

Chacune est argumentée dans [le document d'architecture](docs/02-architecture.md), qui dit aussi ce
que l'outil remplacé payait à leur place.

## Licence

**AGPL-3.0-or-later** — voir [LICENSE](LICENSE).

Copyleft avec clause réseau : quiconque héberge une version modifiée de Flow& doit publier ses
modifications, même sans distribuer le code.

Pas d'exception de liaison : un plugin est chargé dans le processus de l'API et est très
probablement une œuvre dérivée de celui-ci, donc soumis à la même licence. À lire avant d'écrire un
plugin propriétaire.

> Nom : **Flow&** — identifiant technique partout ailleurs : `flow` (paquets `@flow/*`, images
> Docker, schémas SQL, préfixes d'API).
