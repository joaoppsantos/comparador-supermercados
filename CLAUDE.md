# CLAUDE.md

This file provides behavioral and project-specific guidance for Claude when working in this repository.

---

# Behavioral Guidelines

These guidelines are intended to reduce common LLM coding mistakes.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State assumptions explicitly.
- If uncertain, ask instead of guessing.
- If multiple interpretations exist, present them instead of silently choosing one.
- If a simpler approach exists, propose it.
- If requirements are unclear, stop and ask clarifying questions.

## 2. Simplicity First

Write the minimum code necessary to solve the problem.

- No speculative features.
- No abstractions for one-time usage.
- No unnecessary configurability.
- No premature optimization.
- No impossible-scenario error handling.

Before finishing, ask:

> Would a senior engineer think this is unnecessarily complicated?

If yes, simplify.

## 3. Surgical Changes

Only modify code required for the requested task.

When editing existing code:

- Don't refactor unrelated code.
- Don't reformat unrelated files.
- Match the existing project style.
- Mention unrelated issues instead of fixing them.

If your changes create unused code:

- Remove imports, variables, or functions made unused by YOUR changes.
- Do not remove pre-existing dead code unless requested.

Every modified line should directly support the user's request.

## 4. Goal-Driven Execution

Transform requests into verifiable goals.

Examples:

- "Fix the bug" → reproduce it, fix it, verify the fix.
- "Add validation" → add failing tests, implement validation, verify tests pass.
- "Refactor" → ensure behavior is unchanged before and after.

For multi-step tasks:

1. State a short implementation plan.
2. Explain how each step will be verified.
3. Verify the final result before considering the task complete.

---

# Project Overview

## Purpose

**Personal-use** price comparison system for the main Portuguese supermarkets (Continente, Pingo Doce, Lidl, Auchan, El Corte Inglés). Data is collected via scraping (no official public APIs exist today), stored canonically, and served through a web UI with price history, product search, and store-by-store comparison.

Single user, self-hosted (VPS or home server). Priorities: architecture quality, maintainability, and extensibility over implementation speed.

Full architecture plan: **`docs/PLAN.md`** — read it before making structural decisions.

## Key domain rules

- **Data sources are abstracted behind `StoreProvider`.** Nothing outside `packages/providers` may know whether data came from scraping, an official API, or a feed. If a store ships an API later, only its adapter changes.
- **Canonical product vs. store offer**: a `Product` is the physical item (store-agnostic); a `StoreOffer` is that product at one store with a price. Matching decisions (EAN, exact, fuzzy, AI, manual) are persisted with method + confidence and are never silently redone.
- **Price history is append-only and change-based**: a `PricePoint` row is written only when the price changes; `lastSeenAt` on the offer proves freshness.
- **Prices are stored and computed in euro cents (integers)** — format at the display boundary only.
- **Scraping must be polite**: low rate limits (~1 req/s per domain), night-time schedules, retries with backoff. Runs that look anomalous (0 offers, large drops) are quarantined as `SUSPECT` and must not update availability or create products.

## Tech Stack

- TypeScript (strict) everywhere; pnpm workspaces monorepo
- Next.js (App Router) for UI + light API routes — `apps/web`
- Standalone Node worker with BullMQ for scraping/ingestion — `apps/worker`
- PostgreSQL (+ `pg_trgm` for fuzzy matching), Prisma — `packages/db`
- Redis (BullMQ + read cache)
- `undici` + `cheerio` for HTTP/JSON scraping; Playwright only where HTTP is not enough
- zod validation at the provider boundary; pino structured logs; vitest
- Docker Compose for deployment (web + worker + postgres + redis)

## Success Criteria

1. Never corrupt data from a broken scraper — validation at the boundary, quarantine on anomalies.
2. Adding a new supermarket touches only `packages/providers` + one DB row.
3. Adapter breakage is cheap to fix: contract tests on recorded fixtures, push notification on failed runs.
4. Matching is auditable: every offer→product link records how it was made and with what confidence.

## Development Philosophy

- Prefer straightforward solutions; avoid unnecessary abstractions.
- Keep functions focused; prefer readability over cleverness.
- This is a personal project at small scale (~5 stores, tens of thousands of products) — do not design for scale it will never have.
