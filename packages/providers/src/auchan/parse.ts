import * as cheerio from 'cheerio'
import type { RawCategory, RawOffer } from '../types.js'
import { contentAttrToCents, parseUnitPrice } from '../lib/units.js'

const BASE_URL = 'https://www.auchan.pt'

// --- categories -------------------------------------------------------------

/** Supermarket aisles; Auchan also sells electronics, clothing, etc. — skipped. */
const AISLES = new Set([
  'produtos-frescos',
  'alimentacao',
  'congelados',
  'bebidas-e-garrafeira',
  'limpeza-e-cuidados-do-lar',
  'beleza-e-higiene',
  'animais',
])

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => (word.length > 2 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/**
 * Auchan publishes its full category tree in sitemap_8-category.xml. Fan-out
 * on depth-2 categories (aisle/section) within the grocery aisles. The cgid
 * needed by the grid endpoint is not in the sitemap — it is resolved later
 * from the category page itself (see resolveCgid).
 */
export function parseSitemapCategories(xml: string): RawCategory[] {
  const categories: RawCategory[] = []
  const seen = new Set<string>()
  for (const m of xml.matchAll(/<loc>https:\/\/www\.auchan\.pt\/pt\/([a-z0-9/-]+?)\/?<\/loc>/g)) {
    const segments = m[1]!.split('/')
    if (segments.length !== 2) continue
    const [aisle, section] = segments as [string, string]
    if (!AISLES.has(aisle)) continue
    const externalId = `${aisle}/${section}`
    if (seen.has(externalId)) continue
    seen.add(externalId)
    categories.push({
      externalId,
      name: humanizeSlug(section),
      path: [humanizeSlug(aisle), humanizeSlug(section)],
      productCount: null,
    })
  }
  return categories
}

/**
 * Extracts the cgid from a category page (present in its Search-UpdateGrid
 * links). cgids can contain percent-encoded characters ("aguas-t%C3%B3nicas");
 * the value is returned as found, ready to be reused in a URL.
 */
export function parseCgid(categoryPageHtml: string): string | null {
  const m = categoryPageHtml.match(/Search-UpdateGrid\?cgid=([^&"'\s\\]+)/)
  return m?.[1] ?? null
}

// --- product grid -----------------------------------------------------------

interface GtmNew {
  item_id: string
  item_name: string
  item_brand: string
  item_category: string
  item_category2?: string
  item_category3?: string
  item_category4?: string
}

export interface ParsedGrid {
  offers: RawOffer[]
  tileCount: number
  skipped: string[]
}

/**
 * Parses a Search-UpdateGrid fragment. Tile anatomy (see fixtures):
 * - .auc-product-tile root with data-pid, data-urls (productUrl) and
 *   data-gtm-new (GA4 payload with name/brand/category tree)
 * - .price .sales .value[content] current; .auc-price__stricked [content] pre-promo
 * - .auc-measures--price-per-unit: "0.24 €/un"
 */
export function parseGrid(html: string, capturedAt: Date = new Date()): ParsedGrid {
  const $ = cheerio.load(html)
  const offers: RawOffer[] = []
  const skipped: string[] = []
  const tiles = $('.auc-product-tile[data-pid]')

  tiles.each((_, el) => {
    const tile = $(el)
    try {
      const gtmRaw = tile.attr('data-gtm-new') ?? tile.find('[data-gtm-new]').first().attr('data-gtm-new')
      if (!gtmRaw) throw new Error('no data-gtm-new')
      const item = JSON.parse(gtmRaw) as GtmNew
      if (!item.item_id || !item.item_name) throw new Error('gtm payload missing id/name')

      const urlsRaw = tile.attr('data-urls')
      const productUrl = urlsRaw
        ? (JSON.parse(urlsRaw) as { productUrl?: string }).productUrl
        : tile.find('.pdp-link a').first().attr('href')
      if (!productUrl) throw new Error('no product link')

      const currentCents = contentAttrToCents(
        tile.find('.price .sales .value').first().attr('content'),
      )
      if (currentCents === null) throw new Error('no parseable price')
      const struckCents = contentAttrToCents(
        tile.find('.price .strike-through').first().attr('content') ??
          tile.find('.price .strike-through .value').first().attr('content'),
      )
      const hasPromo = struckCents !== null && struckCents > currentCents
      const promoLabel = tile.find('.auc-price__promotion__label').first().text().trim()

      const image = tile.find('img[data-src], img[src]').first()
      const imageUrl = image.attr('data-src') ?? image.attr('src') ?? null

      offers.push({
        externalId: item.item_id,
        ean: null, // available on the detail page (data-ean) via enrichOffer
        rawName: item.item_name,
        brand: item.item_brand || null,
        quantity: null, // sizes only appear in names at Auchan
        priceCents: hasPromo ? struckCents : currentCents,
        unitPrice: parseUnitPrice(tile.find('.auc-measures--price-per-unit').first().text()),
        promo: hasPromo
          ? { type: 'discount', priceCents: currentCents, description: promoLabel }
          : null,
        categoryPath: [item.item_category, item.item_category2, item.item_category3, item.item_category4]
          .filter((c): c is string => Boolean(c)),
        url: new URL(productUrl, BASE_URL).toString(),
        imageUrl: imageUrl && imageUrl.trim() ? new URL(imageUrl, BASE_URL).toString() : null,
        available: true,
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

// --- product detail ----------------------------------------------------------

/** EAN on detail pages: data-ean="..." attribute (also "gtin" in the JSON-LD). */
export function parseDetailEan(html: string): string | null {
  const m = html.match(/data-ean="(\d{8,14})"/) ?? html.match(/"gtin"\s*:\s*"(\d{8,14})"/)
  return m?.[1] ?? null
}
