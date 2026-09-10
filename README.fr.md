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

**Jalon J0 sur onze.** Le socle tient : le dépôt s'installe, se vérifie et se construit, les
contrats partagés et la direction artistique sont posés. **Rien ne s'exécute encore** — il n'y a ni
API, ni base, ni worker, ni bot.

Ce qui est déjà décidé et argumenté vit dans [`docs/`](docs/) :
[périmètre](docs/01-perimetre-fonctionnel.md), [architecture](docs/02-architecture.md),
[interface](docs/12-interface.md), [feuille de route](docs/06-feuille-de-route.md).

Il n'y a donc rien à installer aujourd'hui, et pas encore de quoi donner un avis d'usage. La
[feuille de route](docs/06-feuille-de-route.md) dit dans quel ordre la suite arrive et à quoi se
reconnaît chaque étape terminée.

## Ce que ce sera

**Un bot est du code.** Des métadonnées, un schéma de paramètres Zod, et une fonction qui reçoit une
page Playwright authentique — pas une façade appauvrie. Le formulaire de lancement est déduit du
schéma, si bien que le serveur valide exactement ce que l'interface a affiché.

**Les navigateurs tournent dans un worker séparé.** L'API n'en lance jamais un : elle crée la trace,
publie le travail, rend la main. Un Chromium qui meurt n'emporte plus l'interface, un redémarrage ne
perd plus une exécution, et la charge s'encaisse en ajoutant des workers.

**On voit ce qui se passe.** Journal horodaté persisté au fil de l'eau, progression, et vue en
direct du navigateur par screencast CDP — relayée en WebSocket aux seuls abonnés, pas poussée dans
un circuit permanent par utilisateur.

**Multi-organisation, appliqué par la base.** Les entités forment un arbre et l'isolation repose sur
la Row-Level Security de PostgreSQL — pas sur des clauses `WHERE` qu'on peut oublier d'écrire.

**Extensible sans forker.** Deux SDK, parce que ce sont deux publics : `@flow/bot-sdk` pour écrire
un bot, `@flow/plugin-sdk` pour étendre l'application elle-même.

## Essayer localement

Prérequis : Node 22 ou plus, pnpm 11.

```bash
pnpm install
pnpm --filter @flow/web dev
```

Puis <http://localhost:5173>, qui affiche le nuancier — les jetons de la direction artistique et les
briques d'interface, dans les deux thèmes. C'est tout ce qu'il y a à voir à ce stade, et c'est
volontairement dit plutôt que déguisé en application.

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
| Temps réel         | Redis pub/sub relayé en WebSocket, screencast CDP             |
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
