# Architecture Plan — Portuguese Supermarket Price Comparator

Personal-use system that aggregates prices from Continente, Pingo Doce, Lidl, Auchan, and El Corte Inglés via scraping (no official public APIs exist today), with a canonical data model, price history, and a web UI for search, comparison, and shopping lists.

**Assumptions**: single user, self-hosted (VPS or home server), no multi-tenancy or complex auth. Polite scraping (low rate limits, night-time schedule). Priorities: architecture quality, maintainability, extensibility — not implementation speed.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Monorepo (pnpm workspaces)                                 │
│                                                             │
│  apps/web ──── Next.js (UI + light API routes)              │
│  apps/worker ─ Standalone Node process (BullMQ consumers,   │
│                scheduler, ingestion pipeline)               │
│                                                             │
│  packages/db ──────── Prisma schema + migrations            │
│  packages/core ────── Domain: normalization, matching,      │
│                       pricing, alerts                       │
│  packages/providers ─ StoreProvider interface + one         │
│                       adapter per supermarket               │
└─────────────────────────────────────────────────────────────┘
         │                        │
   PostgreSQL (+pg_trgm)      Redis (BullMQ + cache)
```

Structural decisions:

- **Web and worker are separate processes.** Scraping is long-running work with retries and controlled concurrency — it cannot live in the Next.js request/response cycle. The worker is a plain Node process consuming BullMQ queues.
- **No NestJS.** For personal use a full backend framework is dead weight. Next.js API routes serve the UI; the worker entrypoint is ~50 lines registering consumers. Real logic lives in `packages/core`, testable and independent of both.
- **The critical boundary is `packages/providers`.** Everything above it (ingestion, matching, DB, UI) never knows whether data came from scraping, an official API, or a CSV feed. This is what makes a future scraper→API swap a local change.

## 2. The StoreProvider abstraction

```ts
// packages/providers/src/types.ts

/** Raw offer as the source returns it — the ONLY format that
    crosses the provider → rest-of-system boundary. */
interface RawOffer {
  externalId: string          // product id on the store's site
  ean: string | null          // when the source exposes it
  rawName: string             // "Leite UHT Meio Gordo Mimosa 1L"
  brand: string | null
  priceCents: number
  unitPrice: { cents: number; per: 'kg' | 'l' | 'un' } | null
  promo: { type: string; priceCents: number; description: string } | null
  categoryPath: string[]      // store taxonomy, e.g. ["Laticínios", "Leite"]
  url: string
  imageUrl: string | null
  available: boolean
  capturedAt: Date
}

interface StoreProvider {
  readonly storeSlug: string  // 'continente', 'pingo-doce', ...
  readonly capabilities: {
    exposesEan: boolean
    hasSearch: boolean
    detailFetch: boolean      // can it fetch a single product by id?
  }
  listCategories(): Promise<RawCategory[]>
  listOffers(category: RawCategory): AsyncIterable<RawOffer>
  fetchOffer?(externalId: string): Promise<RawOffer | null>
}
```

Key points:

- **`AsyncIterable` instead of arrays** — lets the pipeline process page by page with natural backpressure, without holding a whole catalog in memory.
- **zod validation at the boundary**: every adapter passes its output through a `RawOffer` schema before handing it over. If a site changes and the adapter starts producing garbage, it fails there, loudly, instead of corrupting the DB.
- **Scraper vs. API is an internal detail of the adapter.** If Pingo Doce ships an API tomorrow, only the inside of `providers/pingo-doce` is rewritten. `capabilities` lets the pipeline adapt (e.g. `exposesEan: false` tells matching it will rely on fuzzy).
- **Declarative registry**: `providers/index.ts` exports a `slug → factory` map. Adding a supermarket = new folder + one registry line + one row in `stores`.

Practical note: **before reaching for Playwright, investigate each site's internal JSON APIs.** Continente runs Salesforce Commerce Cloud, Auchan too, Pingo Doce has Mercadão — nearly all have JSON endpoints the page itself consumes. They are orders of magnitude faster and more stable than parsing rendered HTML. Playwright is the last resort (and Lidl, with a small weekly catalog, may need no more than HTTP + cheerio).

## 3. Canonical data model and schema

Core concept: separate the **canonical product** (the physical thing — "Leite Mimosa Meio Gordo 1L") from the **store offer** (that product at one concrete store, with a price). The link between them records *how* and *with what confidence* it was made.

```prisma
model Store {
  id        Int     @id
  slug      String  @unique
  name      String
  offers    StoreOffer[]
}

model Product {              // canonical, store-agnostic
  id             Int      @id @default(autoincrement())
  ean            String?  @unique
  brand          String?
  name           String
  normalizedName String   // for matching: lowercase, no accents, no stopwords
  quantityValue  Decimal? // 1
  quantityUnit   String?  // 'l', 'kg', 'un'
  categoryId     Int?
  offers         StoreOffer[]
}

model StoreOffer {           // "this product at this store"
  id                Int      @id @default(autoincrement())
  storeId           Int
  productId         Int
  externalId        String   // id at the store
  url               String
  imageUrl          String?
  available         Boolean
  currentPriceCents Int      // denormalized for fast reads
  lastSeenAt        DateTime
  matchMethod       MatchMethod  // EAN | EXACT | FUZZY | AI | MANUAL
  matchConfidence   Float
  priceHistory      PricePoint[]
  @@unique([storeId, externalId])
}

model PricePoint {           // append-only, ONLY when the price changes
  id              Int      @id @default(autoincrement())
  offerId         Int
  priceCents      Int
  promoPriceCents Int?
  promoType       String?
  capturedAt      DateTime
  @@index([offerId, capturedAt])
}

model Category {             // own canonical taxonomy
  id       Int    @id
  slug     String @unique
  parentId Int?
}
model StoreCategoryMap {     // store path → canonical category
  storeId      Int
  externalPath String       // "Laticínios/Leite"
  categoryId   Int
  @@id([storeId, externalPath])
}

model ScrapeRun {            // observability
  id            Int       @id @default(autoincrement())
  storeId       Int
  status        RunStatus // RUNNING | OK | PARTIAL | FAILED | SUSPECT
  startedAt     DateTime
  finishedAt    DateTime?
  offersSeen    Int
  offersChanged Int
  newProducts   Int
  errorCount    Int
  errorSample   Json?
}

model ShoppingList { ... }   // phase 2
model ShoppingListItem {     // points at Product (canonical!),
  productId Int              // not StoreOffer — cross-store comparison
  quantity  Int              // falls out naturally
}
model PriceAlert {           // phase 2
  productId        Int
  targetPriceCents Int?      // or: alert on any drop
  active           Boolean
}
```

Design decisions:

- **Prices in cents (integers)**, always. Formatting only in the UI.
- **`PricePoint` records changes, not captures.** With `lastSeenAt` on the offer you know the price is still valid; history stays compact (a product whose price doesn't move for 6 months = 1 row, not 180). At this scale (~5 stores × ~20–30k products), plain PostgreSQL is more than enough — TimescaleDB would be overengineering.
- **Own canonical taxonomy** with a per-store mapping. Never try to unify store taxonomies directly — they are mutually incompatible and they change. The map is filled semi-manually (a small one-off effort, ~100–200 categories).
- **`matchMethod` + `matchConfidence` on the offer**: match provenance stays auditable, and the UI can flag low-confidence matches.

## 4. Normalization and deduplication — matching cascade

When the pipeline receives a `RawOffer` whose `(storeId, externalId)` doesn't exist yet, it runs this cascade (cheapest/most-reliable first):

1. **EAN** — if the source exposes an EAN and a `Product` with that EAN exists: direct match, confidence 1.0. This is the golden path; adapters should work hard to extract EANs (often present in the detail-page JSON even when absent from listings).
2. **Name normalization** — pure function in `packages/core`: lowercase, strip accents, extract and split off the **brand** (against a brand dictionary built incrementally) and the **quantity** (regex for `\d+\s?(g|kg|ml|cl|l|un|x\d+)`), remove stopwords ("embalagem", "garrafa"). Result: a `(brand, normalizedName, quantity)` tuple.
3. **Exact match** on the normalized tuple → confidence ~0.95.
4. **Fuzzy** — trigram similarity (`pg_trgm`, native to Postgres, no search service needed) over `normalizedName`, **but only within the same brand + quantity bucket** (this eliminates ~95% of false positives — "Iogurte Grego Ananás" vs. "Iogurte Grego Morango" are textually similar but differ in variant). Above threshold (~0.85): auto-match; between 0.6 and 0.85: review queue.
5. **AI for ambiguous pairs** — periodic batch of review-queue pairs sent to Claude Haiku ("are these the same physical product? answer MATCH/NO_MATCH/UNSURE"). Cheap, and the decision is stored as `matchMethod: AI`. `UNSURE` goes to manual review — a simple UI page for approving/rejecting pairs (for personal use, ~10 minutes a week).
6. **No match** → create a new canonical `Product`. A false negative (duplicated product) is recoverable: a "merge" action in the review UI fuses two `Product`s and repoints offers/history.

Golden rule: **matching decisions are persistent** (via `StoreOffer` ↔ `Product`). Re-scrapes never re-match known offers — only new products enter the cascade.

## 5. Scheduling, resilience, and observability

**Orchestration (BullMQ):**

- One nightly repeatable job per store, **staggered** (Continente 02:00, Pingo Doce 02:45, ...) to avoid overloading either side.
- The store job runs `listCategories()` and fans out one job per category — granularity that enables partial retry: if 3 of 150 categories fail, only those 3 are retried.
- **BullMQ's native rate limiting per queue/store** (e.g. 1 request/second, concurrency 1–2 per domain). Polite and sufficient — a full run takes 1–2h overnight, which is irrelevant.
- Retries with exponential backoff + jitter (BullMQ built-in), 3 attempts, then dead-letter.

**Defense against site changes** (the #1 failure mode of this kind of project):

- **Recorded fixtures per adapter**: each adapter has contract tests running its parser against captured real HTML/JSON. When a site changes, you update the fixture and the test tells you exactly what broke.
- **Post-run sanity checks**: if a run returns 0 offers, or <60% of the previous run, or an anomalous rate of "new products" (the classic symptom of a parser extracting wrong ids), the run is marked `SUSPECT` and **its data does not update availability or create products** — it is quarantined. This prevents the disaster of a broken selector marking 20,000 products unavailable.
- zod validation at the boundary (see above) — partial parses fail item by item with a log entry, never silently.

**Logs and monitoring:**

- `pino` structured logs, every line tagged with `runId` + `storeSlug`.
- The `ScrapeRun` table *is* the dashboard: an `/admin/runs` page shows recent runs, counts, and error samples.
- **Push notification via ntfy.sh** (or a Telegram bot) whenever a run ends `FAILED`/`SUSPECT` — the right level of alerting for personal use; Grafana/Prometheus would be overkill.

## 6. Minimizing scraping and optimizing

- **Extract from listing pages, not detail pages.** Name, price, promo, and image are in the listing; ~40 products per request instead of 1. Detail pages only for **new** products (to obtain EAN and full data), once.
- **Per-category payload hash**: store the hash of the response; if identical to yesterday's, skip parsing and bulk-update `lastSeenAt = now()`.
- **Tiered frequency**: products in shopping lists or with active alerts → guaranteed daily refresh (via targeted `fetchOffer` when the capability exists); full catalog → daily or every other day; dead tails (unseen for 30 days) → weekly.
- Redis cache only for UI aggregations (e.g. "cheapest basket"), with TTL until the next run — data changes once a day, so the UI can be cached aggressively.

## 7. Stack — concrete recommendation

| Layer | Choice | Why |
|---|---|---|
| Language | Strict TypeScript, end to end | shared types across provider/core/UI |
| Monorepo | pnpm workspaces (Turborepo optional) | 2 apps + 3 packages need no more |
| Frontend + API | Next.js App Router | server components for data pages |
| Worker | Node + BullMQ | separate process, same `packages/core` |
| Database | PostgreSQL + `pg_trgm` | native fuzzy matching, no Elasticsearch |
| ORM | Prisma | declarative schema, migrations; performance irrelevant at this scale |
| Queues/cache | Redis | BullMQ requirement; read cache |
| HTTP scraping | `undici` + `cheerio` | first resort: the sites' internal JSON APIs |
| Browser scraping | Playwright | last resort, only where HTTP falls short |
| Validation | zod | RawOffer boundary |
| Logs | pino | structured, cheap |
| Personal alerting | ntfy.sh | push to phone with a single `fetch` |
| Deploy | Docker Compose on a VPS/home server | web + worker + postgres + redis |
| Tests | vitest | adapter contract tests (fixtures) + matching unit tests |

## 8. Roadmap by phases

**Phase 0 — Foundations (the most important phase)**
Monorepo, docker-compose, full Prisma schema (including `ScrapeRun` from day 1), `StoreProvider` interface + zod, ingestion pipeline, **a single adapter** (Continente — large catalog, accessible internal API), price history, logging. Exit criterion: one command runs a full Continente scrape, populates the DB, and a second run records only changes.

**Phase 1 — Comparable MVP**
Second and third adapters (Pingo Doce, Auchan) — this is where the abstraction gets properly validated. EAN + exact matching. Minimal UI: search, product page with side-by-side prices and a history chart, `/admin/runs` page. Exit criterion: search "leite mimosa" and see 3 prices compared with history.

**Phase 2 — Daily-usable version**
Lidl + El Corte Inglés (the awkward ones — Lidl has a different catalog model, ECI may require Playwright). Fuzzy matching + review/merge UI. Final nightly scheduling, sanity checks/quarantine, ntfy notifications. Shopping lists and price alerts. Exit criterion: you use this weekly to decide where to shop, with no maintenance.

**Phase 3 — Advanced**
Full-cart comparison per store (including optimal split basket), normalized unit price (€/kg, €/L) to compare different formats, batch AI-assisted matching, PWA with barcode scanner (the EAN links directly to the canonical product — the architecture already supports it for free), promo-pattern analysis.

---

## Main risks, so there are no surprises

1. **Adapter maintenance is the real cost of the project** — sites change. Fixtures + quarantine + notifications reduce this to "I get a push, I update a selector in 20 minutes." Budget for that reality.
2. **Matching without EAN is inherently imperfect** (Lidl's private labels barely cross-match with anyone — and that's fine: a private-label product remains a canonical product with a single offer). Chasing 100% deduplication is not worth it.
3. **Site ToS** generally prohibit automated scraping. For personal use, with polite rate limits and overnight runs, the practical risk is low (worst case: IP block), but it stands noted.
