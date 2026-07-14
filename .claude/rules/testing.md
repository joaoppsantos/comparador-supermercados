Critical paths that must have tests (vitest):

- Adapter contract tests: each adapter's parser runs against recorded HTML/JSON fixtures and produces valid RawOffer objects (tests/providers).
- Name normalization: brand/quantity extraction and normalization are pure functions with unit tests covering real product-name samples.
- Matching cascade: EAN match wins over exact over fuzzy; fuzzy only matches within same brand + quantity bucket; below-threshold pairs go to review, never auto-match.
- Ingestion idempotence: re-ingesting an unchanged offer writes no PricePoint and only bumps lastSeenAt; a changed price writes exactly one PricePoint.
- Quarantine: a run with 0 offers or a large drop vs. the previous run is marked SUSPECT and does not update availability or create products.
