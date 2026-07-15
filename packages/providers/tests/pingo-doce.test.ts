import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCategories, parseGrid } from '../src/pingo-doce/parse.js'
import { rawCategorySchema, rawOfferSchema } from '../src/types.js'

// Contract tests against recorded fixtures (captured 2026-07-14).

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, 'fixtures/pingo-doce', name), 'utf-8')
}

describe('parseCategories', () => {
  it('extracts level-2 fan-out categories from the site navigation', () => {
    const categories = parseCategories(fixture('home.html'))
    expect(categories.length).toBeGreaterThan(50)
    for (const category of categories) {
      expect(() => rawCategorySchema.parse(category)).not.toThrow()
    }
    const leite = categories.find((c) => c.externalId === 'ec_leite_900_100')
    expect(leite).toBeDefined()
    expect(leite!.name).toBe('Leite')
    expect(leite!.path).toHaveLength(2)
    // zero-width characters from the site are stripped
    for (const category of categories) {
      expect(category.name).not.toMatch(/[​-‍]/)
    }
    // no level-3 categories (they are covered by their level-2 parents)
    expect(categories.some((c) => c.externalId === 'ec_leitemeiogordoegordo_900_100_300')).toBe(false)
  })
})

describe('parseGrid', () => {
  it('parses the leite grid with explicit package sizes and unit prices', () => {
    const { offers, tileCount, skipped } = parseGrid(fixture('grid-leite.html'))
    expect(tileCount).toBe(38)
    expect(skipped).toEqual([])
    for (const offer of offers) expect(() => rawOfferSchema.parse(offer)).not.toThrow()

    const mimosa = offers.find((o) => o.externalId === '41043')
    expect(mimosa).toMatchObject({
      rawName: 'Leite UHT Meio Gordo',
      brand: 'Mimosa',
      quantity: { value: 1, unit: 'l' },
      unitPrice: { cents: 90, per: 'l' },
      priceCents: 100, // pre-promo price
      promo: { type: 'discount', priceCents: 90 },
      ean: null,
      available: true,
    })
    expect(mimosa!.url).toBe(
      'https://www.pingodoce.pt/home/produtos/leite-e-bebidas-vegetais%E2%80%8B/leite/leite-meio-gordo-e-gordo%E2%80%8B/leite-uht-meio-gordo-mimosa-41043.html',
    )
    expect(mimosa!.imageUrl).toContain('41043')
  })

  it('includes store-only products (grid recorded without the onlineFlag filter)', () => {
    // regression: the onlineFlag=true filter used to hide products sold only
    // in physical stores, e.g. Água Penacova
    const { offers, skipped } = parseGrid(fixture('grid-aguas.html'))
    expect(skipped).toEqual([])
    const penacova = offers.find((o) => o.externalId === '749441')
    expect(penacova).toMatchObject({
      rawName: 'Água sem Gás',
      brand: 'Penacova',
      quantity: { value: 5, unit: 'l' },
      unitPrice: { cents: 21, per: 'l' },
      priceCents: 105,
    })
  })
})
