import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPrisma, type PrismaClient, type ScrapeRun } from '@comparador/db'
import type { RawOffer } from '@comparador/providers'
import { evaluateRunSanity, finalizeRun } from '../src/index.js'

// Integration tests for the staging → sanity check → ingest pipeline.
// Requires the test database (vitest.global-setup.ts pushes the schema).

const prisma: PrismaClient = createPrisma(
  process.env.TEST_DATABASE_URL ??
    `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/comparador_test`,
)

function makeOffer(overrides: Partial<RawOffer> = {}): RawOffer {
  return {
    externalId: 'p-1',
    ean: null,
    rawName: 'Leite UHT Meio Gordo 1L',
    brand: 'Mimosa',
    quantity: null,
    priceCents: 100,
    unitPrice: { cents: 100, per: 'l' },
    promo: null,
    categoryPath: ['Laticínios', 'Leite'],
    url: 'https://example.com/produto/p-1.html',
    imageUrl: null,
    available: true,
    capturedAt: new Date('2026-07-14T03:00:00Z'),
    ...overrides,
  }
}

async function createStore(): Promise<number> {
  const store = await prisma.store.create({ data: { slug: 'teststore', name: 'Test Store' } })
  return store.id
}

async function stageRun(
  storeId: number,
  offers: RawOffer[],
  meta: { bounded?: boolean; planned?: string[] } = {},
): Promise<ScrapeRun> {
  const run = await prisma.scrapeRun.create({
    data: {
      storeId,
      meta: {
        planned: meta.planned ?? ['cat-a'],
        bounded: meta.bounded ?? true,
        maxPages: null,
      },
    },
  })
  for (const offer of offers) {
    await prisma.stagingOffer.create({
      data: {
        runId: run.id,
        externalId: offer.externalId,
        payload: JSON.parse(JSON.stringify(offer)) as object,
      },
    })
  }
  return run
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PricePoint", "StoreOffer", "StagingOffer", "ScrapeRun", "PriceAlert", "ShoppingListItem", "ShoppingList", "Product", "StoreCategoryMap", "Category", "Store" RESTART IDENTITY CASCADE',
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('ingestion', () => {
  it('creates product, offer and first price point for a new offer', async () => {
    const storeId = await createStore()
    const run = await stageRun(storeId, [makeOffer()])
    const finished = await finalizeRun(prisma, run.id)

    expect(finished.status).toBe('OK')
    expect(finished).toMatchObject({ offersSeen: 1, newOffers: 1, offersChanged: 0 })

    const offer = await prisma.storeOffer.findUniqueOrThrow({
      where: { storeId_externalId: { storeId, externalId: 'p-1' } },
      include: { priceHistory: true, product: true },
    })
    expect(offer.currentPriceCents).toBe(100)
    expect(offer.matchMethod).toBe('NEW')
    expect(offer.priceHistory).toHaveLength(1)
    expect(offer.product.quantityUnit).toBe('l')
    // staging is cleaned up after a successful ingest
    expect(await prisma.stagingOffer.count({ where: { runId: run.id } })).toBe(0)
  })

  it('is idempotent: an unchanged price writes no new PricePoint, only bumps lastSeenAt', async () => {
    const storeId = await createStore()
    await finalizeRun(prisma, (await stageRun(storeId, [makeOffer()])).id)

    const later = new Date('2026-07-15T03:00:00Z')
    const run2 = await stageRun(storeId, [makeOffer({ capturedAt: later })])
    const finished = await finalizeRun(prisma, run2.id)

    expect(finished).toMatchObject({ offersSeen: 1, newOffers: 0, offersChanged: 0 })
    expect(await prisma.pricePoint.count()).toBe(1)
    const offer = await prisma.storeOffer.findFirstOrThrow()
    expect(offer.lastSeenAt).toEqual(later)
  })

  it('writes exactly one PricePoint when the price or promo changes', async () => {
    const storeId = await createStore()
    await finalizeRun(prisma, (await stageRun(storeId, [makeOffer()])).id)

    const promoOffer = makeOffer({
      promo: { type: 'discount', priceCents: 90, description: '' },
      capturedAt: new Date('2026-07-15T03:00:00Z'),
    })
    const finished = await finalizeRun(prisma, (await stageRun(storeId, [promoOffer])).id)

    expect(finished).toMatchObject({ offersSeen: 1, newOffers: 0, offersChanged: 1 })
    const points = await prisma.pricePoint.findMany({ orderBy: { id: 'asc' } })
    expect(points).toHaveLength(2)
    expect(points[1]).toMatchObject({ priceCents: 100, promoPriceCents: 90 })
  })
})

describe('matching cascade', () => {
  it('EAN match wins over name differences', async () => {
    const storeId = await createStore()
    await finalizeRun(
      prisma,
      (await stageRun(storeId, [makeOffer({ ean: '5601234567890' })])).id,
    )

    const differentName = makeOffer({
      externalId: 'p-2',
      ean: '5601234567890',
      rawName: 'Leite Meio Gordo UHT Garrafa 1lt',
      brand: null,
    })
    await finalizeRun(prisma, (await stageRun(storeId, [differentName])).id)

    expect(await prisma.product.count()).toBe(1)
    const second = await prisma.storeOffer.findUniqueOrThrow({
      where: { storeId_externalId: { storeId, externalId: 'p-2' } },
    })
    expect(second.matchMethod).toBe('EAN')
    expect(second.matchConfidence).toBe(1)
  })

  it('exact normalized-tuple match links offers without EAN, ignoring word order', async () => {
    const storeId = await createStore()
    await finalizeRun(prisma, (await stageRun(storeId, [makeOffer()])).id)

    const reordered = makeOffer({
      externalId: 'p-2',
      rawName: 'Leite Meio Gordo UHT 1L', // same tokens, different order
    })
    await finalizeRun(prisma, (await stageRun(storeId, [reordered])).id)

    expect(await prisma.product.count()).toBe(1)
    const second = await prisma.storeOffer.findUniqueOrThrow({
      where: { storeId_externalId: { storeId, externalId: 'p-2' } },
    })
    expect(second.matchMethod).toBe('EXACT')
  })

  it('identical names with conflicting EANs stay separate products (pack-size variants)', async () => {
    const storeId = await createStore()
    // real case from Continente: same name, no quantity in the name,
    // one EAN per pack size
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-1',
            ean: '5000116110407',
            rawName: 'Hambúrguer de Frango sem Glúten Capitão Iglo',
          }),
        ])
      ).id,
    )
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-2',
            ean: '5000116110414',
            rawName: 'Hambúrguer de Frango sem Glúten Capitão Iglo',
            priceCents: 1499,
          }),
        ])
      ).id,
    )
    expect(await prisma.product.count()).toBe(2)
  })

  it('links the same product across stores that state sizes differently', async () => {
    // Continente-style: size only derivable from the unit price
    const storeA = await createStore()
    await finalizeRun(
      prisma,
      (
        await stageRun(storeA, [
          makeOffer({
            externalId: 'cont-1',
            rawName: 'Leite UHT Meio Gordo Mimosa', // no size in the name
            brand: 'Mimosa',
            priceCents: 86,
            unitPrice: { cents: 86, per: 'l' },
          }),
        ])
      ).id,
    )
    // Pingo Doce-style: explicit quantity field, brand outside the name
    const storeB = await prisma.store.create({ data: { slug: 'otherstore', name: 'Other' } })
    await finalizeRun(
      prisma,
      (
        await stageRun(storeB.id, [
          makeOffer({
            externalId: 'pd-1',
            rawName: 'Leite UHT Meio Gordo',
            brand: 'Mimosa',
            priceCents: 100,
            quantity: { value: 1, unit: 'l' },
            unitPrice: { cents: 90, per: 'l' },
            promo: { type: 'discount', priceCents: 90, description: '' },
          }),
        ])
      ).id,
    )

    expect(await prisma.product.count()).toBe(1)
    const offers = await prisma.storeOffer.findMany()
    expect(offers).toHaveLength(2)
    expect(offers[0]!.productId).toBe(offers[1]!.productId)
  })

  it('identical names without EANs stay separate when unit prices imply different sizes', async () => {
    const storeId = await createStore()
    const name = 'Hambúrguer de Frango sem Glúten Capitão Iglo' // no quantity in the name
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-1',
            rawName: name,
            priceCents: 499,
            unitPrice: { cents: 1000, per: 'kg' }, // ≈ 0.5 kg box
          }),
        ])
      ).id,
    )
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-2',
            rawName: name,
            priceCents: 1899,
            unitPrice: { cents: 1000, per: 'kg' }, // ≈ 1.9 kg box → different variant
          }),
        ])
      ).id,
    )
    expect(await prisma.product.count()).toBe(2)
  })

  it('similar inferred sizes still merge (price drift does not split products)', async () => {
    const storeId = await createStore()
    const name = 'Hambúrguer de Frango sem Glúten Capitão Iglo'
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-1',
            rawName: name,
            priceCents: 500,
            unitPrice: { cents: 1000, per: 'kg' },
          }),
        ])
      ).id,
    )
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({
            externalId: 'p-2',
            rawName: name,
            priceCents: 510,
            unitPrice: { cents: 1020, per: 'kg' }, // same 0.5 kg box, price moved
          }),
        ])
      ).id,
    )
    expect(await prisma.product.count()).toBe(1)
  })

  it('different quantity means a different product', async () => {
    const storeId = await createStore()
    await finalizeRun(prisma, (await stageRun(storeId, [makeOffer()])).id)
    await finalizeRun(
      prisma,
      (
        await stageRun(storeId, [
          makeOffer({ externalId: 'p-2', rawName: 'Leite UHT Meio Gordo 200ml' }),
        ])
      ).id,
    )
    expect(await prisma.product.count()).toBe(2)
  })
})

describe('quarantine', () => {
  it('evaluateRunSanity flags the classic broken-scraper signatures', () => {
    expect(
      evaluateRunSanity({ offersStaged: 0, prospectiveNew: 0, previousOffersSeen: null }),
    ).toHaveLength(1)
    expect(
      evaluateRunSanity({ offersStaged: 50, prospectiveNew: 0, previousOffersSeen: 100 }),
    ).toHaveLength(1)
    expect(
      evaluateRunSanity({ offersStaged: 100, prospectiveNew: 40, previousOffersSeen: 100 }),
    ).toHaveLength(1)
    expect(
      evaluateRunSanity({ offersStaged: 95, prospectiveNew: 5, previousOffersSeen: 100 }),
    ).toHaveLength(0)
  })

  it('marks a full run with zero offers SUSPECT and ingests nothing', async () => {
    const storeId = await createStore()
    const run = await stageRun(storeId, [], { bounded: false })
    const finished = await finalizeRun(prisma, run.id)

    expect(finished.status).toBe('SUSPECT')
    expect(await prisma.storeOffer.count()).toBe(0)
  })

  it('quarantines a big drop vs the previous full run, keeping staging for inspection', async () => {
    const storeId = await createStore()
    // previous full run: 100 offers seen
    await prisma.scrapeRun.create({
      data: {
        storeId,
        status: 'OK',
        offersSeen: 100,
        meta: { planned: ['cat-a'], bounded: false, maxPages: null },
      },
    })

    const run = await stageRun(storeId, [makeOffer()], { bounded: false })
    const finished = await finalizeRun(prisma, run.id)

    expect(finished.status).toBe('SUSPECT')
    expect(await prisma.storeOffer.count()).toBe(0) // nothing ingested
    expect(await prisma.stagingOffer.count({ where: { runId: run.id } })).toBe(1) // kept
  })

  it('a full-coverage run marks offers it no longer sees as unavailable', async () => {
    const storeId = await createStore()
    // seed three known offers via a bounded run
    const seed = [
      makeOffer({ externalId: 'p-1', rawName: 'Produto Um 1L' }),
      makeOffer({ externalId: 'p-2', rawName: 'Produto Dois 1L' }),
      makeOffer({ externalId: 'p-3', rawName: 'Produto Três 1L' }),
    ]
    await finalizeRun(prisma, (await stageRun(storeId, seed)).id)
    await prisma.scrapeRun.updateMany({
      data: { status: 'OK', offersSeen: 3 },
      where: { storeId },
    })
    await prisma.scrapeRun.updateMany({
      data: { meta: { planned: ['cat-a'], bounded: false, maxPages: null } },
      where: { storeId },
    })

    // full run sees only two of them (66% of previous → passes sanity).
    // capturedAt must be after run.startedAt or the sweep would flag them too.
    const later = new Date(Date.now() + 60_000)
    const run = await stageRun(
      storeId,
      [seed[0], seed[1]].map((o) => ({ ...o!, capturedAt: later })),
      { bounded: false },
    )
    const finished = await finalizeRun(prisma, run.id)

    expect(finished.status).toBe('OK')
    const missing = await prisma.storeOffer.findUniqueOrThrow({
      where: { storeId_externalId: { storeId, externalId: 'p-3' } },
    })
    expect(missing.available).toBe(false)
    const kept = await prisma.storeOffer.findUniqueOrThrow({
      where: { storeId_externalId: { storeId, externalId: 'p-1' } },
    })
    expect(kept.available).toBe(true)
  })
})
