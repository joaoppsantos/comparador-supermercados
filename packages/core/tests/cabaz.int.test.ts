import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPrisma, type PrismaClient } from '@comparador/db'
import { normalizeName, resolveCabaz } from '../src/index.js'

const prisma: PrismaClient = createPrisma(
  process.env.TEST_DATABASE_URL ??
    `postgresql://${process.env.USER ?? 'postgres'}@localhost:5432/comparador_test`,
)

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PricePoint", "StoreOffer", "StagingOffer", "ScrapeRun", "PriceAlert", "ShoppingListItem", "ShoppingList", "Product", "StoreCategoryMap", "Category", "Store" RESTART IDENTITY CASCADE',
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function seedOffer(
  storeId: number,
  productId: number,
  externalId: string,
  priceCents: number,
) {
  await prisma.storeOffer.create({
    data: {
      storeId,
      productId,
      externalId,
      url: `https://example.com/${externalId}`,
      available: true,
      currentPriceCents: priceCents,
      lastSeenAt: new Date(),
      matchMethod: 'NEW',
      matchConfidence: 1,
    },
  })
}

async function seedProduct(name: string, brand: string, qty: { value: number; unit: string }) {
  return prisma.product.create({
    data: {
      name,
      brand,
      normalizedName: normalizeName(name, brand),
      quantityValue: qty.value,
      quantityUnit: qty.unit,
    },
  })
}

describe('resolveCabaz', () => {
  it('prefers the same canonical product across stores and falls back to similar ones', async () => {
    const storeA = await prisma.store.create({ data: { slug: 'a', name: 'A' } })
    const storeB = await prisma.store.create({ data: { slug: 'b', name: 'B' } })

    // shared product in both stores + a cheaper similar one in store A only
    const cigala = await seedProduct('Arroz Agulha Cigala 1kg', 'Cigala', { value: 1, unit: 'kg' })
    const proprio = await seedProduct('Arroz Agulha Bom 1kg', 'Bom', { value: 1, unit: 'kg' })
    await seedOffer(storeA.id, cigala.id, 'a-1', 129)
    await seedOffer(storeB.id, cigala.id, 'b-1', 119)
    await seedOffer(storeA.id, proprio.id, 'a-2', 99)

    // milk exists only as different products per store
    const leiteA = await seedProduct('Leite UHT Meio Gordo Serra 1L', 'Serra', { value: 1, unit: 'l' })
    const leiteB = await seedProduct('Leite UHT Meio Gordo Vale 1L', 'Vale', { value: 1, unit: 'l' })
    await seedOffer(storeA.id, leiteA.id, 'a-3', 95)
    await seedOffer(storeB.id, leiteB.id, 'b-3', 89)

    const items = [
      { label: 'Arroz', tokens: ['arroz', 'agulha'], targetQty: { value: 1, unit: 'kg' as const } },
      { label: 'Leite', tokens: ['leite', 'uht'], targetQty: { value: 1, unit: 'l' as const } },
    ]
    const { rows, totals } = await resolveCabaz(prisma, items)

    const arroz = rows[0]!.cells
    // same product wins over the cheaper similar one
    expect(arroz[storeA.id]).toMatchObject({ productId: cigala.id, priceCents: 129, sameProduct: true })
    expect(arroz[storeB.id]).toMatchObject({ productId: cigala.id, priceCents: 119, sameProduct: true })

    const leite = rows[1]!.cells
    expect(leite[storeA.id]).toMatchObject({ productId: leiteA.id, sameProduct: false })
    expect(leite[storeB.id]).toMatchObject({ productId: leiteB.id, sameProduct: false })

    expect(totals[storeA.id]).toEqual({ totalCents: 129 + 95, covered: 2 })
    expect(totals[storeB.id]).toEqual({ totalCents: 119 + 89, covered: 2 })
  })

  it('a pinned anchor product wins even when a cheaper similar exists in its store', async () => {
    const store = await prisma.store.create({ data: { slug: 'a', name: 'A' } })
    const premium = await seedProduct('Arroz Agulha Cigala 1kg', 'Cigala', { value: 1, unit: 'kg' })
    const cheap = await seedProduct('Arroz Agulha Bom 1kg', 'Bom', { value: 1, unit: 'kg' })
    await seedOffer(store.id, premium.id, 'a-1', 189)
    await seedOffer(store.id, cheap.id, 'a-2', 99)

    const { rows } = await resolveCabaz(prisma, [
      {
        label: 'Arroz',
        tokens: ['arroz', 'agulha'],
        targetQty: { value: 1, unit: 'kg' },
        anchorProductId: premium.id,
      },
    ])
    expect(rows[0]!.cells[store.id]).toMatchObject({
      productId: premium.id,
      priceCents: 189,
      sameProduct: true,
    })
  })

  it('addCabazEntryForProduct derives label, tokens and size from the product', async () => {
    const store = await prisma.store.create({ data: { slug: 'a', name: 'A' } })
    const product = await seedProduct('Iogurte Grego Natural Oikos 4x110g', 'Oikos', {
      value: 0.44,
      unit: 'kg',
    })
    await seedOffer(store.id, product.id, 'a-1', 249)

    const { addCabazEntryForProduct, getCabazItems } = await import('../src/index.js')
    expect(await addCabazEntryForProduct(prisma, product.id)).toBe(true)

    const items = await getCabazItems(prisma)
    const added = items.find((i) => i.anchorProductId === product.id)
    expect(added).toBeDefined()
    expect(added!.tokens).toContain('grego')
    expect(added!.tokens).not.toContain('oikos') // brand is not a token
    expect(added!.targetQty).toEqual({ value: 0.44, unit: 'kg' })
  })

  it('a manual per-store choice overrides the automatic resolution', async () => {
    const store = await prisma.store.create({ data: { slug: 'a', name: 'A' } })
    const auto = await seedProduct('Iogurte Grego Natural Serra 4x110g', 'Serra', { value: 0.44, unit: 'kg' })
    const picked = await seedProduct('Iogurte Grego Ligeiro Vale 4x115g', 'Vale', { value: 0.46, unit: 'kg' })
    await seedOffer(store.id, auto.id, 'a-1', 149)
    await seedOffer(store.id, picked.id, 'a-2', 199)

    const entry = await prisma.cabazEntry.create({
      data: { label: 'Iogurte Grego', tokens: ['iogurte', 'grego'], position: 0 },
    })
    await prisma.cabazEntryChoice.create({
      data: { entryId: entry.id, storeId: store.id, productId: picked.id },
    })

    const { rows } = await resolveCabaz(prisma, [
      { id: entry.id, label: 'Iogurte Grego', tokens: ['iogurte', 'grego'] },
    ])
    expect(rows[0]!.cells[store.id]).toMatchObject({
      productId: picked.id,
      priceCents: 199,
      sameProduct: true,
      manual: true,
    })
  })

  it('rejects candidates outside the target package size', async () => {
    const store = await prisma.store.create({ data: { slug: 'a', name: 'A' } })
    const mini = await seedProduct('Leite UHT Meio Gordo Serra 200ml', 'Serra', { value: 0.2, unit: 'l' })
    await seedOffer(store.id, mini.id, 'a-1', 45)

    const { rows } = await resolveCabaz(prisma, [
      { label: 'Leite', tokens: ['leite', 'uht'], targetQty: { value: 1, unit: 'l' } },
    ])
    expect(rows[0]!.cells[store.id]).toBeNull()
  })
})
