# comparador-supermercados

Personal price comparator for Portuguese supermarkets (Continente, Pingo Doce, Lidl, Auchan, El Corte Inglés). Scrapes prices into a canonical product model with full price history. Architecture: [`docs/PLAN.md`](docs/PLAN.md). Operations: [`docs/MANUAL.md`](docs/MANUAL.md).

## Layout

- `apps/worker` — BullMQ worker: nightly scrapes, staging → sanity checks → ingest
- `packages/providers` — `StoreProvider` abstraction + one adapter per store
- `packages/core` — normalization, matching, ingestion, quarantine
- `packages/db` — Prisma schema (PostgreSQL)

## Setup

Requires Node ≥ 22, pnpm, PostgreSQL and Redis (locally via Homebrew, or `docker compose up -d`).

```sh
brew services start postgresql@17 redis   # or: docker compose up -d
createdb comparador
cp .env.example .env
pnpm install
pnpm db:migrate                            # apply schema
```

## Usage

```sh
pnpm scrape continente                     # one-shot full scrape (1–2h, polite rate limits)
pnpm scrape continente --categories laticinios-leite --max-pages 2   # bounded test run
pnpm worker                                # long-lived worker with nightly schedules (Lisbon time)
pnpm web                                   # UI at http://localhost:3000 (search, product, /admin/runs)
pnpm test                                  # unit + contract + integration tests (needs postgres)
pnpm typecheck
```

Stores implemented: **Continente**, **Pingo Doce**, **Auchan** (Lidl and El Corte Inglés are phase 2).

Bounded runs (`--categories`/`--max-pages`) skip sanity checks and the availability sweep — partial coverage is expected there. Full runs that look broken (zero offers, big drops, too many never-seen products) are marked `SUSPECT` and quarantined: staged data is kept for inspection and nothing touches the real tables.
