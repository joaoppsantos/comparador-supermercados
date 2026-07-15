import { HttpStatusError, politeFetch } from '../http.js'
import {
  rawOfferSchema,
  type ListOffersOptions,
  type ProviderOptions,
  type RawCategory,
  type RawOffer,
  type StoreProvider,
} from '../types.js'
import { parseCategoryTree, parseDetailEan, parseGrid } from './parse.js'

const BASE_URL = 'https://www.continente.pt'
const GRID_URL = `${BASE_URL}/on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid`
const PAGE_SIZE = 35 // the grid endpoint caps sz at 35
const MAX_PAGES_SAFETY = 500

export class ContinenteProvider implements StoreProvider {
  readonly storeSlug = 'continente'
  readonly storeName = 'Continente'
  readonly capabilities = { exposesEanInListing: false, enrich: true }

  private readonly warn: (message: string) => void
  private readonly minIntervalMs: number | undefined

  constructor(opts: ProviderOptions = {}) {
    this.warn = opts.warn ?? ((msg) => console.warn(`[continente] ${msg}`))
    this.minIntervalMs = opts.minIntervalMs
  }

  private fetchText(url: string): Promise<string> {
    return politeFetch(url, { minIntervalMs: this.minIntervalMs })
  }

  async listCategories(): Promise<RawCategory[]> {
    const html = await this.fetchText(`${BASE_URL}/`)
    return parseCategoryTree(html)
  }

  async *listOffers(category: RawCategory, opts: ListOffersOptions = {}): AsyncIterable<RawOffer> {
    const seen = new Set<string>()
    const maxPages = Math.min(opts.maxPages ?? MAX_PAGES_SAFETY, MAX_PAGES_SAFETY)

    for (let page = 0; page < maxPages; page++) {
      const url = `${GRID_URL}?cgid=${encodeURIComponent(category.externalId)}&pmin=0.01&start=${page * PAGE_SIZE}&sz=${PAGE_SIZE}`
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
