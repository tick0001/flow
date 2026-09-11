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

**Milestone J5 of eleven. A failure is diagnosed on screen.** Drop a bot folder, launch it from the
interface through a form derived from its schema, and it runs in a separate worker driving Chromium.
The log, the progress and the **live browser view** are pushed by the server. When it breaks, the
**screenshot at the moment of failure** and the **Playwright trace** are on the page, along with a
filterable log — without opening a terminal.

Before it: the entity tree, PostgreSQL Row-Level Security, sessions, rights, account
administration, both languages, the bot SDK, execution in a separate worker, and real time.

**There is not yet** scheduling, API keys, or dashboards.

What is already decided and argued lives in [`docs/`](docs/), in French:
[functional scope](docs/01-perimetre-fonctionnel.md), [architecture](docs/02-architecture.md),
[entities, rights and security](docs/03-entites-droits-securite.md),
[bot SDK](docs/15-sdk-bots.md), [execution lifecycle](docs/16-cycle-d-execution.md),
[real time](docs/17-temps-reel.md), [history and storage](docs/18-historique-et-stockage.md),
[interface](docs/12-interface.md), [roadmap](docs/06-feuille-de-route.md).

Isolation between organisations is proven by integration tests against a real PostgreSQL database:
they all fail when pointed at the owner role, which is what makes them worth anything. Cancellation
is proven the same way, against a real browser: the tests time out at two minutes if the browser
context close is removed, instead of finishing in five seconds. And the real-time broadcast is
checked by querying the database as each line arrives — nothing is broadcast that is not already
written. The
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
of the browser through the CDP screencast — relayed to subscribers only, not pushed
down a permanent per-user circuit.

**Multi-organisation, enforced by the database.** Entities form a tree, and isolation rests on
PostgreSQL Row-Level Security — not on `WHERE` clauses somebody can forget to write.

**Extensible without forking.** Two SDKs, because they serve two audiences: `@flow/bot-sdk` to write
a bot, `@flow/plugin-sdk` to extend the application itself.

## Try it locally

Requirements: Node 22 or later, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up      # PostgreSQL and Redis, on shifted ports
pnpm db:migrate       # schema, triggers, RLS policies
pnpm navigateurs      # Chromium, for the worker — once
FLOW_ADMIN_PASSWORD='pick-a-real-one' pnpm db:init
pnpm dev              # API :3100, interface :5273, worker
```

Then <http://localhost:5273>. The first sign-in forces a password change.

A reference bot already sits in [`bots/`](bots/exemple-bonjour): build it (`pnpm build`), open
**Bots**, and run it against an address of your choosing.

The worker installs its browsers separately, and never at startup: an application that downloads
Chromium on first launch turns a corporate proxy outage into an application that will not start.

Ports are shifted from the usual ones — 5433, 6380, 3100, 5273 — so that Flow& and the other
projects of the collection can run side by side.

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
| Real time          | Redis pub/sub relayed over SSE, CDP screencast                |
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
