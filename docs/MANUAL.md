# Operator's Manual

How to run, monitor, and maintain the comparador. Architecture and rationale live in [`PLAN.md`](PLAN.md); this file is the day-to-day reference.

## 1. Prerequisites

- Node ≥ 22 and pnpm
- PostgreSQL 17 and Redis, either local (`brew services start postgresql@17 redis`) or via `docker compose up -d`

## 2. First-time setup

```sh
createdb comparador          # brew postgres; docker compose creates it itself
cp .env.example .env         # then edit DATABASE_URL — with Homebrew Postgres,
                             # include your macOS user: postgresql://<user>@localhost:5432/comparador
pnpm install                 # also generates the Prisma client
pnpm db:migrate              # applies migrations (needs DATABASE_URL exported or in packages/db/.env)
```

If `pnpm db:migrate` can't find the database URL, run it explicitly:

```sh
DATABASE_URL=postgresql://$(whoami)@localhost:5432/comparador pnpm db:migrate
```

## 3. Running scrapes

### One-shot (CLI)

```sh
pnpm scrape continente                                                # full scrape, ~1–2h at polite rates
pnpm scrape continente --categories congelados-refeicoes-hamburguer  # only these category ids
pnpm scrape continente --categories laticinios-leite --max-pages 2   # cap listing pages per category
```

The CLI boots the workers in-process, runs to completion, prints a JSON summary, and exits non-zero if the run ended `SUSPECT`/`FAILED`.

**Bounded runs** (any run with `--categories` or `--max-pages`) skip sanity checks and the availability sweep — partial coverage is expected there. Use them for testing; only full runs maintain availability.

### Long-lived worker (nightly schedule)

```sh
pnpm worker    # consumes queues + runs the nightly full scrapes
               # (02:00 Continente, 03:30 Auchan, 05:00 Pingo Doce — Europe/Lisbon)
```

Keep it running under launchd/systemd/tmux on the machine that hosts the scraper.

### Web UI

```sh
pnpm web       # http://localhost:3000
```

Search by name/brand/EAN on the home page; product pages show per-store prices,
promo/unit prices, match provenance, and the price-history chart; `/admin/runs`
is the scrape dashboard.

## 4. Reading run results

Every scrape is a `ScrapeRun` row. Statuses:

| Status | Meaning | Data effect |
|---|---|---|
| `RUNNING` | in progress | — |
| `OK` | full success | ingested; availability sweep ran (full runs) |
| `PARTIAL` | some category jobs failed after retries | ingested; **no** availability sweep |
| `SUSPECT` | failed sanity checks (zero offers, <60% of previous run, >30% never-seen offers) | **quarantined**: staged rows kept in `StagingOffer`, nothing ingested |
| `FAILED` | all categories failed, nothing staged | nothing ingested |

Useful queries:

```sql
-- recent runs
SELECT id, status, "offersSeen", "offersChanged", "newOffers", "errorCount", "startedAt", "finishedAt"
FROM "ScrapeRun" ORDER BY id DESC LIMIT 10;

-- why was a run quarantined?
SELECT meta->'suspectReasons' FROM "ScrapeRun" WHERE id = <runId>;

-- price history of a product
SELECT pp."capturedAt", pp."priceCents", pp."promoPriceCents"
FROM "PricePoint" pp JOIN "StoreOffer" o ON o.id = pp."offerId"
WHERE o."productId" = <productId> ORDER BY pp."capturedAt";
```

After inspecting a `SUSPECT` run: if the data was actually fine (e.g. the store genuinely shrank its catalog), there is no auto-replay yet — just let the next nightly run pick things up; if the scraper is broken, fix the adapter (see §6) — staging rows are deleted only by a successful later ingest of a new run.

## 5. Tests and typecheck

```sh
pnpm test        # contract + unit + integration (integration needs local Postgres;
                 # schema is pushed to comparador_test automatically)
pnpm typecheck
```

## 6. When a store changes its site

Symptoms: a run ends `SUSPECT`/`FAILED`, or warnings like `skipped tile … no parseable price` flood the logs.

1. Re-record the fixtures (same URLs are noted at the top of each fixture file in
   `packages/providers/tests/fixtures/<store>/`).
2. Run `pnpm test` — the contract tests point at exactly which parser broke.
3. Fix the selectors/regexes in `packages/providers/src/<store>/parse.ts`.
4. Verify with a bounded live run: `pnpm scrape <store> --categories <small-cat> --max-pages 1`.

## 7. Adding a new supermarket

1. Create `packages/providers/src/<slug>/` with a class implementing `StoreProvider`
   (`listCategories`, `listOffers`, optional `enrichOffer`). Prefer the site's internal
   JSON API over HTML; use `politeFetch` for all requests.
2. Register it in `packages/providers/src/index.ts` (one line in the registry).
3. Record fixtures and write contract tests (`packages/providers/tests/<slug>.test.ts`).
4. Add a nightly schedule entry in `apps/worker/src/index.ts`, staggered from the other stores.
5. Verify with a bounded run. The `Store` row is created automatically on first scrape.

Nothing outside `packages/providers` should need to change.

## 8. Troubleshooting

- **Prisma `P1010: User was denied access`** — your `DATABASE_URL` has no user; Homebrew
  Postgres has no `postgres` role. Use `postgresql://<macos-user>@localhost:5432/comparador`.
- **`ECONNREFUSED 127.0.0.1:6379`** — Redis isn't running: `brew services start redis`.
- **Run stuck `RUNNING`** — the worker died mid-run. Restart it; category jobs are
  idempotent (staging upserts) and BullMQ resumes pending jobs. If the flow was lost,
  the run stays `RUNNING` forever — mark it `FAILED` manually and re-enqueue.
- **HTTP 403 from a store** — likely bot detection. Don't tighten the request loop;
  raise `SCRAPE_MIN_INTERVAL_MS` in `.env` and retry later.
