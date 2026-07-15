import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCgid, parseDetailEan, parseGrid, parseSitemapCategories } from '../src/auchan/parse.js'
import { rawCategorySchema, rawOfferSchema } from '../src/types.js'

// Contract tests against recorded fixtures (captured 2026-07-14).

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, 'fixtures/auchan', name), 'utf-8')
}

describe('parseSitemapCategories', () => {
  it('extracts depth-2 grocery categories from the category sitemap', () => {
    const categories = parseSitemapCategories(fixture('sitemap-category.xml'))
    expect(categories.length).toBeGreaterThan(30)
    for (const category of categories) {
      expect(() => rawCategorySchema.parse(category)).not.toThrow()
      expect(category.externalId.split('/')).toHaveLength(2)
    }
    const lacteos = categories.find((c) => c.externalId === 'alimentacao/produtos-lacteos')
    expect(lacteos).toBeDefined()
    expect(lacteos!.path[0]).toBe('Alimentacao')
    // non-grocery aisles are excluded
    expect(categories.some((c) => c.externalId.startsWith('tecnologia/'))).toBe(false)
    expect(categories.some((c) => c.externalId.startsWith('campanhas/'))).toBe(false)
  })
})

describe('parseCgid', () => {
  it('finds the cgid embedded in a category page', () => {
    expect(parseCgid('...Search-UpdateGrid?cgid=alimentacao-&amp;prefn1=...')).toBe('alimentacao-')
    expect(parseCgid('<html>no grid here</html>')).toBeNull()
  })
})

describe('parseGrid', () => {
  it('parses the alimentação grid into valid RawOffers', () => {
    const { offers, tileCount, skipped } = parseGrid(fixture('grid-alimentacao.html'))
    expect(tileCount).toBeGreaterThanOrEqual(24)
    expect(skipped).toEqual([])
    for (const offer of offers) expect(() => rawOfferSchema.parse(offer)).not.toThrow()

    const ovos = offers.find((o) => o.externalId === '446856')
    expect(ovos).toMatchObject({
      rawName: 'OVOS AUCHAN GALINHAS SOLO CLASSE M DUAS DÚZIAS',
      brand: 'AUCHAN',
      priceCents: 575,
      unitPrice: { cents: 24, per: 'un' },
      ean: null,
    })
    expect(ovos!.url).toContain('/446856.html')
    expect(ovos!.categoryPath).toContain('Produtos Lácteos')

    const promos = offers.filter((o) => o.promo !== null)
    for (const offer of promos) {
      expect(offer.promo!.priceCents).toBeLessThan(offer.priceCents)
    }
  })
})

describe('parseDetailEan', () => {
  it('extracts the EAN from the data-ean attribute on detail pages', () => {
    expect(parseDetailEan(fixture('pdp.html'))).toBe('5601002043030')
  })
})
