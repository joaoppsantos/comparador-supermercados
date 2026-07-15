import { HttpStatusError, politeFetch } from '../http.js'
import {
  rawOfferSchema,
  type ListOffersOptions,
  type ProviderOptions,
  type RawCategory,
  type RawOffer,
  type StoreProvider,
} from '../types.js'
import { parseCgid, parseDetailEan, parseGrid, parseSitemapCategories } from './parse.js'

const BASE_URL = 'https://www.auchan.pt'
const GRID_URL = `${BASE_URL}/on/demandware.store/Sites-AuchanPT-Site/default/Search-UpdateGrid`
const PAGE_SIZE = 100
const MAX_PAGES_SAFETY = 200

export class AuchanProvider implements StoreProvider {
  readonly storeSlug = 'auchan'
  readonly storeName = 'Auchan'
  readonly capabilities = { exposesEanInListing: false, enrich: true }

  private readonly warn: (message: string) => void
  private readonly minIntervalMs: number | undefined

  constructor(opts: ProviderOptions = {}) {
    this.warn = opts.warn ?? ((msg) => console.warn(`[auchan] ${msg}`))
    this.minIntervalMs = opts.minIntervalMs
  }

  private fetchText(url: string): Promise<string> {
    return politeFetch(url, { minIntervalMs: this.minIntervalMs })
  }

  async listCategories(): Promise<RawCategory[]> {
    const xml = await this.fetchText(`${BASE_URL}/sitemap_8-category.xml`)
    const categories = parseSitemapCategories(xml)
    if (categories.length === 0) {
      throw new Error('no categories found in auchan.pt category sitemap (layout changed?)')
    }
    return categories
  }

  async *listOffers(category: RawCategory, opts: ListOffersOptions = {}): AsyncIterable<RawOffer> {
    // The sitemap has no cgids; the category page embeds its own.
    const pageHtml = await this.fetchText(`${BASE_URL}/pt/${category.externalId}/`)
    const cgid = parseCgid(pageHtml)
    if (!cgid) {
      throw new Error(`no cgid found on category page ${category.externalId} (layout changed?)`)
    }

    const seen = new Set<string>()
    const maxPages = Math.min(opts.maxPages ?? MAX_PAGES_SAFETY, MAX_PAGES_SAFETY)

    for (let page = 0; page < maxPages; page++) {
      const url = `${GRID_URL}?cgid=${encodeURIComponent(cgid)}&prefn1=soldInStores&prefv1=000&start=${page * PAGE_SIZE}&sz=${PAGE_SIZE}`
      const html = await this.fetchText(url)
      const { offers, tileCount, skipped } = parseGrid(html)

      for (const failure of skipped) {
        this.warn(`skipped tile in ${category.externalId} page ${page}: ${failure}`)
      }
      for (const offer of offers) {
        if (seen.has(offer.externalId)) continue
        seen.add(offer.externalId)
        const parsed = rawOfferSchema.safeParse(offer)
        if (!parsed.success) {
          this.warn(`invalid offer ${offer.externalId}: ${parsed.error.message}`)
          continue
        }
        yield parsed.data
      }

      if (tileCount < PAGE_SIZE) return
    }
  }

  /** Fetches the product detail page to fill in the EAN. Failure is non-fatal. */
  async enrichOffer(offer: RawOffer): Promise<RawOffer> {
    if (offer.ean) return offer
    try {
      const html = await this.fetchText(offer.url)
      const ean = parseDetailEan(html)
      if (!ean) {
        this.warn(`no EAN on detail page for ${offer.externalId}`)
        return offer
      }
      return { ...offer, ean }
    } catch (err) {
      if (err instanceof HttpStatusError) {
        this.warn(`detail fetch ${err.status} for ${offer.externalId}, keeping listing data`)
        return offer
      }
      throw err
    }
  }
}
