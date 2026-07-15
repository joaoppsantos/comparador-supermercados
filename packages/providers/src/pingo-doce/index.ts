import { politeFetch } from '../http.js'
import {
  rawOfferSchema,
  type ListOffersOptions,
  type ProviderOptions,
  type RawCategory,
  type RawOffer,
  type StoreProvider,
} from '../types.js'
import { parseCategories, parseGrid } from './parse.js'

const BASE_URL = 'https://www.pingodoce.pt'
const GRID_URL = `${BASE_URL}/on/demandware.store/Sites-pingo-doce-Site/default/Search-UpdateGrid`
const PAGE_SIZE = 100
const MAX_PAGES_SAFETY = 200

export class PingoDoceProvider implements StoreProvider {
  readonly storeSlug = 'pingo-doce'
  readonly storeName = 'Pingo Doce'
  readonly capabilities = { exposesEanInListing: false, enrich: false }

  private readonly warn: (message: string) => void
  private readonly minIntervalMs: number | undefined

  constructor(opts: ProviderOptions = {}) {
    this.warn = opts.warn ?? ((msg) => console.warn(`[pingo-doce] ${msg}`))
    this.minIntervalMs = opts.minIntervalMs
  }

  private fetchText(url: string): Promise<string> {
    return politeFetch(url, { minIntervalMs: this.minIntervalMs })
  }

  async listCategories(): Promise<RawCategory[]> {
    const html = await this.fetchText(`${BASE_URL}/`)
    const categories = parseCategories(html)
    if (categories.length === 0) {
      throw new Error('no categories found in pingodoce.pt navigation (site layout changed?)')
    }
    return categories
  }

  async *listOffers(category: RawCategory, opts: ListOffersOptions = {}): AsyncIterable<RawOffer> {
    const seen = new Set<string>()
    const maxPages = Math.min(opts.maxPages ?? MAX_PAGES_SAFETY, MAX_PAGES_SAFETY)

    for (let page = 0; page < maxPages; page++) {
      const url = `${GRID_URL}?cgid=${encodeURIComponent(category.externalId)}&pmin=0.04&prefn1=onlineFlag&prefv1=true&start=${page * PAGE_SIZE}&sz=${PAGE_SIZE}`
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
}
