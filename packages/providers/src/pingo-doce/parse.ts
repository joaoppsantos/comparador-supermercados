import * as cheerio from 'cheerio'
import type { RawCategory, RawOffer } from '../types.js'
import { contentAttrToCents, parseUnitPrice, stripInvisible, toBaseQuantity } from '../lib/units.js'

const BASE_URL = 'https://www.pingodoce.pt'

// --- categories -------------------------------------------------------------

/**
 * Category ids encode their tree position in numeric suffixes:
 *   ec_leitebebidasvegetais_900         (level 1)
 *   ec_leite_900_100                    (level 2)
 *   ec_leitemeiogordoegordo_900_100_300 (level 3)
 */
function numericPath(cgid: string): string[] {
  return cgid.split('_').filter((part) => /^\d+$/.test(part))
}

/**
 * Extracts the category list from the navigation of any full pingodoce.pt page
 * (links to Search-Show?cgid=ec_*). Fans out on level-2 categories; level-1
 * categories without children are included directly.
 */
export function parseCategories(html: string): RawCategory[] {
  const $ = cheerio.load(html)
  const byId = new Map<string, { name: string; path: string[] }>()
  $('a[href*="Search-Show?cgid=ec_"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = href.match(/cgid=(ec_[a-z0-9_]+)/)
    const name = stripInvisible($(el).text())
    if (!m || m[1] === undefined || !name || byId.has(m[1])) return
    byId.set(m[1], { name, path: numericPath(m[1]) })
  })

  const level1ByKey = new Map<string, { cgid: string; name: string }>()
  const level2Keys = new Set<string>()
  for (const [cgid, entry] of byId) {
    if (entry.path.length === 1 && entry.path[0] !== undefined) {
      level1ByKey.set(entry.path[0], { cgid, name: entry.name })
    }
    if (entry.path.length === 2 && entry.path[0] !== undefined) level2Keys.add(entry.path[0])
  }

  const categories: RawCategory[] = []
  for (const [cgid, entry] of byId) {
    if (entry.path.length === 2) {
      const parent = entry.path[0] === undefined ? undefined : level1ByKey.get(entry.path[0])
      categories.push({
        externalId: cgid,
        name: entry.name,
        path: parent ? [parent.name, entry.name] : [entry.name],
        productCount: null,
      })
    } else if (entry.path.length === 1 && entry.path[0] !== undefined && !level2Keys.has(entry.path[0])) {
      categories.push({ externalId: cgid, name: entry.name, path: [entry.name], productCount: null })
    }
  }
  return categories
}

// --- product grid -----------------------------------------------------------

interface GtmItem {
  item_id: string
  item_name: string
  item_brand: string
  item_category: string
}

export interface ParsedGrid {
  offers: RawOffer[]
  tileCount: number
  skipped: string[]
}

/**
 * Parses a Search-UpdateGrid fragment. Tile anatomy (see fixtures):
 * - .product-tile-pd root with data-pid and data-gtm-info (GA4 payload)
 * - .product-unit: "1 L | 0,9 €/L" — explicit package size + unit price
 * - .product-price .sales .value[content] current; .strike-through .value[content] pre-promo
 * - fresh weighted items price per kg and carry a data-display-quantity conversion
 */
export function parseGrid(html: string, capturedAt: Date = new Date()): ParsedGrid {
  const $ = cheerio.load(html)
  const offers: RawOffer[] = []
  const skipped: string[] = []
  const tiles = $('.product-tile-pd')

  tiles.each((_, el) => {
    const tile = $(el)
    try {
      const gtmRaw = tile.attr('data-gtm-info')
      if (!gtmRaw) throw new Error('no data-gtm-info')
      const item = (JSON.parse(gtmRaw) as { items: GtmItem[] }).items[0]
      if (!item?.item_id || !item.item_name) throw new Error('gtm payload missing id/name')

      const href = tile.find('.product-name-link a, a.product-tile-image-link').first().attr('href')
      if (!href) throw new Error('no product link')
      const url = new URL(href, BASE_URL)
      url.search = ''

      const currentCents = contentAttrToCents(
        tile.find('.product-price .sales .value').first().attr('content'),
      )
      if (currentCents === null) throw new Error('no parseable price')
      const struckCents = contentAttrToCents(
        tile.find('.product-price .strike-through .value').first().attr('content'),
      )
      const hasPromo = struckCents !== null && struckCents > currentCents
      const promoMessage = stripInvisible(tile.find('.promo-message').first().text())

      // "1 L | 0,9 €/L"
      const unitText = tile.find('.product-unit').first().text()
      const [qtyPart, unitPricePart] = unitText.split('|').map((s) => s.trim())
      let quantity: RawOffer['quantity'] = null
      if (qtyPart) {
        const m = qtyPart.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/)
        if (m && m[1] !== undefined && m[2] !== undefined) quantity = toBaseQuantity(m[1], m[2])
      }
      // fresh weighted items: quantity of one selling unit ("1 Un ⇄ 0,16 kg")
      if (!quantity) {
        const conv = tile.find('[data-display-quantity]').first()
        const value = Number.parseFloat(conv.attr('data-display-quantity') ?? '')
        const unit = conv.attr('data-display-unit')
        if (Number.isFinite(value) && value > 0 && unit) {
          quantity = toBaseQuantity(String(value), unit)
        }
      }
      const salesText = tile.find('.product-price .sales').first().text()
      const perKgPrice = /€\s*\/\s*kg/i.test(salesText.replace(/\s+/g, ' '))
      const unitPrice = unitPricePart
        ? parseUnitPrice(unitPricePart)
        : perKgPrice
          ? { cents: currentCents, per: 'kg' as const }
          : null

      offers.push({
        externalId: item.item_id,
        ean: null, // Pingo Doce does not expose EANs anywhere
        rawName: stripInvisible(item.item_name),
        brand: stripInvisible(item.item_brand) || null,
        quantity,
        priceCents: hasPromo ? struckCents : currentCents,
        unitPrice,
        promo: hasPromo
          ? { type: 'discount', priceCents: currentCents, description: promoMessage }
          : null,
        categoryPath: item.item_category ? [stripInvisible(item.item_category)] : [],
        url: url.toString(),
        imageUrl: tile.find('img.product-tile-component-image').first().attr('src') ?? null,
        available: true, // grids are filtered by onlineFlag
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
