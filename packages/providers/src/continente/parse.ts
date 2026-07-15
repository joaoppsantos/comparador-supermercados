import * as cheerio from 'cheerio'
import type { RawCategory, RawOffer } from '../types.js'

// --- category tree ---------------------------------------------------------

interface CategoryNode {
  id: string
  name: string
  hitCount?: number
  subCategories?: CategoryNode[]
}

/** Cross-cutting campaign categories whose products all live in real aisles too. */
const EXCLUDED_TOP_LEVEL_IDS = new Set(['campanhas-novidades'])

/** Extracts a balanced {...} JSON object starting at `start` in `src`. */
function extractBalancedJson(src: string, start: number): string {
  let depth = 0
  let inString = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('Unbalanced JSON object in page source')
}

/**
 * Parses `window.rootCategoryObj = {...}` embedded in every full continente.pt
 * page into the fan-out categories: one per second-level category (good job
 * granularity), falling back to the top level when it has no children.
 */
export function parseCategoryTree(html: string): RawCategory[] {
  const marker = 'window.rootCategoryObj'
  const at = html.indexOf(marker)
  if (at < 0) throw new Error('rootCategoryObj not found in page (site layout changed?)')
  const braceAt = html.indexOf('{', at)
  const root = JSON.parse(extractBalancedJson(html, braceAt)) as CategoryNode

  const categories: RawCategory[] = []
  for (const top of root.subCategories ?? []) {
    if (EXCLUDED_TOP_LEVEL_IDS.has(top.id)) continue
    const children = (top.subCategories ?? []).filter((c) => c.hitCount !== 0)
    if (children.length === 0) {
      if (top.hitCount === 0) continue
      categories.push({
        externalId: top.id,
        name: top.name,
        path: [top.name],
        productCount: top.hitCount ?? null,
      })
      continue
    }
    for (const child of children) {
      categories.push({
        externalId: child.id,
        name: child.name,
        path: [top.name, child.name],
        productCount: child.hitCount ?? null,
      })
    }
  }
  return categories
}

// --- product grid ----------------------------------------------------------

interface TileImpression {
  name: string
  id: string
  price: number
  brand: string
  category: string
}

/** "1,19€/kg" | "0,86€" → cents (119 | 86). Returns null when no price found. */
export function parsePriceText(text: string): number | null {
  const m = text.replace(/\s+/g, '').match(/(\d+)(?:[.,](\d{1,2}))?€/)
  if (!m || m[1] === undefined) return null
  const euros = Number(m[1])
  const centsPart = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'))
  return euros * 100 + centsPart
}

const UNIT_PER_MAP: Record<string, 'kg' | 'l' | 'un'> = {
  kg: 'kg',
  l: 'l',
  lt: 'l',
  ltr: 'l',
  un: 'un',
  uni: 'un',
}

/** "0,86€/lt" → { cents: 86, per: 'l' }. */
export function parseUnitPriceText(text: string): RawOffer['unitPrice'] {
  const m = text.replace(/\s+/g, '').match(/(\d+)(?:[.,](\d{1,2}))?€\/(\w+)/)
  if (!m || m[1] === undefined || m[3] === undefined) return null
  const per = UNIT_PER_MAP[m[3].toLowerCase()]
  if (!per) return null
  const cents = Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')))
  if (cents <= 0) return null
  return { cents, per }
}

export interface ParsedGrid {
  offers: RawOffer[]
  tileCount: number
  skipped: string[] // per-tile parse failures (external ids or snippets), for logging
}

/**
 * Parses a Search-UpdateGrid HTML fragment. Structure (recorded in fixtures):
 * - tile root carries data-product-tile-impression (JSON: name/id/price/brand/category)
 * - current price in .pwc-tile--price-primary; when .list .strike-through is
 *   present its text is the pre-promo price and the primary price is promotional
 * - unit price in .pwc-tile--price-secondary ("0,86€/lt")
 * - unavailable products show a .dual-badge-unavailable-message without d-none
 */
export function parseGrid(html: string, capturedAt: Date = new Date()): ParsedGrid {
  const $ = cheerio.load(html)
  const offers: RawOffer[] = []
  const skipped: string[] = []
  const tiles = $('[data-product-tile-impression]')

  tiles.each((_, el) => {
    const tile = $(el)
    // Editorial banners (recipes, campaigns) share the tile markup but have
    // no price block — they are not products, skip them silently.
    if (tile.find('.pwc-price-wrap').length === 0) return
    try {
      const impression = JSON.parse(
        tile.attr('data-product-tile-impression') ?? '',
      ) as TileImpression
      if (!impression.id || !impression.name) throw new Error('impression missing id/name')

      const url = tile.find('a[href*="/produto/"]').first().attr('href')
      if (!url) throw new Error('no product link')

      const currentCents = parsePriceText(tile.find('.pwc-tile--price-primary').first().text())
      if (currentCents === null || currentCents <= 0) throw new Error('no parseable price')

      const struckCents = parsePriceText(tile.find('.list .strike-through').first().text())
      const hasPromo = struckCents !== null && struckCents > currentCents

      const unavailableBadge = tile.find('.dual-badge-unavailable-message').first()
      const available =
        unavailableBadge.length === 0 || (unavailableBadge.attr('class') ?? '').includes('d-none')

      const imageUrl =
        tile.find('img.ct-tile-image').first().attr('data-src') ??
        tile.find('img.ct-tile-image').first().attr('src') ??
        null

      offers.push({
        externalId: impression.id,
        ean: null, // not exposed in listings; enrichOffer gets it from the detail page
        rawName: impression.name,
        brand: impression.brand || null,
        quantity: null, // sizes only appear in names at Continente
        priceCents: hasPromo ? struckCents : currentCents,
        unitPrice: parseUnitPriceText(tile.find('.pwc-tile--price-secondary').first().text()),
        promo: hasPromo ? { type: 'discount', priceCents: currentCents, description: '' } : null,
        categoryPath: impression.category ? impression.category.split('/') : [],
        url,
        imageUrl,
        available,
        capturedAt,
      })
    } catch (err) {
      skipped.push(
        `${tile.attr('data-pid') ?? 'unknown-pid'}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })

  return { offers, tileCount: tiles.length, skipped }
}

// --- product detail --------------------------------------------------------

/**
 * The EAN appears on detail pages in the nutritional-info AJAX URL:
 * ProductNutritionalInfoTab?pid=...&ean=5601312508007&...
 */
export function parseDetailEan(html: string): string | null {
  const m = html.match(/ProductNutritionalInfoTab\?[^"'\s]*?ean=(\d{8,14})/)
  return m?.[1] ?? null
}
