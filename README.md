**English** · [Français](README.fr.md)

# Flow&

**Open-source, self-hosted browser automation.** Bots written in TypeScript, run on behalf of a
whole organisation, with the log, the progress and a live view of what they are doing — and a record
of what happened when they break.

[![Licence](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)

Part of the **tick&** collection, alongside [Tick&](https://tickand.fr), an ITSM ticketing tool,
whose stack, conventions and visual language Flow& shares.

---

## Where the project stands

**Milestone J0 of eleven.** The foundation holds: the repository installs, checks and builds, and
the shared contracts and the design system are in place. **Nothing runs yet** — there is no API, no
database, no worker, no bot.

What is already decided and argued lives in [`docs/`](docs/), in French:
[functional scope](docs/01-perimetre-fonctionnel.md), [architecture](docs/02-architecture.md),
[interface](docs/12-interface.md), [roadmap](docs/06-feuille-de-route.md).

So there is nothing to install today, and nothing yet to have an opinion about in use. The
[roadmap](docs/06-feuille-de-route.md) says in what order the rest arrives, and how each step is
recognised as finished.

## What it will be

**A bot is code.** Metadata, a Zod parameter schema, and a function that receives a genuine
Playwright page — not an impoverished façade. The launch form is derived from the schema, so the
server validates exactly what the interface displayed.

**Browsers run in a separate worker.** The API never launches one: it records the run, publishes the
job, and hands back. A dying Chromium no longer takes the interface with it, a restart no longer
loses an execution, and load is absorbed by adding workers.

**You can see what is happening.** Timestamped log persisted as it goes, progress, and a live view
of the browser through the CDP screencast — relayed over WebSocket to subscribers only, not pushed
down a permanent per-user circuit.

**Multi-organisation, enforced by the database.** Entities form a tree, and isolation rests on
PostgreSQL Row-Level Security — not on `WHERE` clauses somebody can forget to write.

**Extensible without forking.** Two SDKs, because they serve two audiences: `@flow/bot-sdk` to write
a bot, `@flow/plugin-sdk` to extend the application itself.

## Try it locally

Requirements: Node 22 or later, pnpm 11.

```bash
pnpm install
pnpm --filter @flow/web dev
```

Then <http://localhost:5173>, which shows the swatch page — the design tokens and the interface
building blocks, in both themes. That is all there is to see at this stage, and it is said plainly
rather than dressed up as an application.

## Develop

```bash
pnpm build       # builds every package
pnpm test        # the test suite
pnpm lint        # ESLint with type-aware rules
pnpm typecheck   # type checking without emit
pnpm format      # applies Prettier
```

Continuous integration runs exactly that. A local failure is a remote failure.

## Design decisions

| Topic              | Decision                                                      |
| ------------------ | ------------------------------------------------------------- |
| Backend            | NestJS (TypeScript)                                           |
| Execution          | Separate worker, Playwright, BullMQ queue on Redis            |
| Database           | PostgreSQL — `ltree`, `jsonb`, `tsvector`, Row-Level Security |
| Data access        | Drizzle ORM, schema split per module                          |
| Frontend           | React + Vite, Tailwind, TanStack Query & Table                |
| Real time          | Redis pub/sub relayed over WebSocket, CDP screencast          |
| Extensions         | ESM modules, versioned manifest, two SDKs on their own semver |
| Multi-organisation | Hierarchical entities + PostgreSQL Row-Level Security         |
| Deployment         | Self-hosted, Docker Compose, and without containers           |
| Authentication     | Local + LDAP / Active Directory                               |

The reasoning behind each is argued in [the architecture document](docs/02-architecture.md), which
also says what the tool it replaces was paying instead.

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md), which opens with what you should know before cloning: the
codebase, its comments, its documentation and its commit messages are all in French.

Bug reports in English are welcome all the same.

## Licence

**AGPL-3.0-or-later** — see [LICENSE](LICENSE).

Copyleft with a network clause: anyone hosting a modified version of Flow& must publish their
modifications, even without distributing the code.

No linking exception: a plugin is loaded into the API process and is very probably a derivative work
of it, and therefore subject to the same licence. Worth reading before writing a proprietary plugin.

> Name: **Flow&** — technical identifier everywhere else: `flow` (`@flow/*` packages, Docker images,
> SQL schemas, API prefixes).
