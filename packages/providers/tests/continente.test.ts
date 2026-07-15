import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseCategoryTree,
  parseDetailEan,
  parseGrid,
  parsePriceText,
  parseUnitPriceText,
} from '../src/continente/parse.js'
import { rawCategorySchema, rawOfferSchema } from '../src/types.js'

// Contract tests against recorded fixtures (captured 2026-07-14).
// When continente.pt changes layout, refresh the fixtures and these tests
// will point at exactly what broke.

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, 'fixtures/continente', name), 'utf-8')
}

describe('parsePriceText', () => {
  it('parses plain and per-unit price texts', () => {
    expect(parsePriceText('0,86€')).toBe(86)
    expect(parsePriceText(' 1,19€/kg ')).toBe(119)
    expect(parsePriceText('12€')).toBe(1200)
    expect(parsePriceText('1,5€')).toBe(150)
    expect(parsePriceText('sem preço')).toBeNull()
  })
})

describe('parseUnitPriceText', () => {
  it('parses unit prices and normalizes the unit', () => {
    expect(parseUnitPriceText('0,86€/lt')).toEqual({ cents: 86, per: 'l' })
    expect(parseUnitPriceText('0,24€/un')).toEqual({ cents: 24, per: 'un' })
    expect(parseUnitPriceText('1,19€/kg')).toEqual({ cents: 119, per: 'kg' })
    expect(parseUnitPriceText('')).toBeNull()
  })
})

describe('parseCategoryTree', () => {
  it('extracts fan-out categories from the embedded rootCategoryObj', () => {
    const categories = parseCategoryTree(fixture('categories.html'))
    expect(categories.length).toBeGreaterThan(30)
    for (const category of categories) {
      expect(() => rawCategorySchema.parse(category)).not.toThrow()
      expect(category.productCount).not.toBe(0)
    }
    // second-level fan-out with the parent name in the path
    const peixaria = categories.find((c) => c.externalId === 'peixaria-e-talho-peixaria')
    expect(peixaria).toBeDefined()
    expect(peixaria!.path).toEqual(['Frescos', 'Peixaria'])
    // cross-cutting campaign categories are excluded
    expect(categories.some((c) => c.path[0] === 'Novidades')).toBe(false)
  })
})

describe('parseGrid', () => {
  it('parses every tile of the laticínios grid into valid RawOffers', () => {
    const { offers, tileCount, skipped } = parseGrid(fixture('grid-laticinios.html'))
    expect(tileCount).toBe(12)
    expect(skipped).toEqual([])
    expect(offers).toHaveLength(12)
    for (const offer of offers) expect(() => rawOfferSchema.parse(offer)).not.toThrow()

    const leite = offers.find((o) => o.externalId === '6879912')
    expect(leite).toMatchObject({
      rawName: 'Leite UHT Meio Gordo Continente',
      brand: 'Continente',
      priceCents: 86,
      unitPrice: { cents: 86, per: 'l' },
      promo: null,
      available: true,
    })
    expect(leite!.url).toContain('/produto/')
    expect(leite!.imageUrl).toContain('6879912')
    expect(leite!.categoryPath[0]).toBe('Laticínios e Ovos')
  })

  it('parses promotional prices from the mercearia grid', () => {
    const { offers, tileCount, skipped } = parseGrid(fixture('grid-mercearia.html'))
    expect(tileCount).toBe(35)
    expect(skipped).toEqual([])
    for (const offer of offers) expect(() => rawOfferSchema.parse(offer)).not.toThrow()

    const promos = offers.filter((o) => o.promo !== null)
    expect(promos.length).toBeGreaterThan(0)
    for (const offer of promos) {
      expect(offer.promo!.priceCents).toBeLessThan(offer.priceCents)
    }
  })
})

describe('parseDetailEan', () => {
  it('extracts the EAN from the nutritional-info URL on detail pages', () => {
    expect(parseDetailEan(fixture('pdp.html'))).toBe('5601312508007')
  })

  it('returns null when no EAN is present', () => {
    expect(parseDetailEan('<html><body>nada</body></html>')).toBeNull()
  })
})
