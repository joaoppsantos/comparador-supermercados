import { z } from 'zod'

export const rawCategorySchema = z.object({
  externalId: z.string().min(1), // category id in the store's system (e.g. SFCC cgid)
  name: z.string().min(1),
  path: z.array(z.string().min(1)).min(1), // names from the top level down
  productCount: z.number().int().nonnegative().nullable(),
})
export type RawCategory = z.infer<typeof rawCategorySchema>

/**
 * Raw offer as the source returns it — the ONLY format that crosses the
 * provider → rest-of-system boundary. Validated with zod so a broken
 * scraper fails loudly instead of corrupting the database.
 */
export const rawOfferSchema = z.object({
  externalId: z.string().min(1),
  ean: z
    .string()
    .regex(/^\d{8,14}$/)
    .nullable(),
  rawName: z.string().min(1),
  brand: z.string().min(1).nullable(),
  priceCents: z.number().int().positive(),
  /** Package size when the store states it outside the name (e.g. Pingo Doce's "1 L | 0,9 €/L"). */
  quantity: z
    .object({
      value: z.number().positive(),
      unit: z.enum(['kg', 'l', 'un']),
    })
    .nullable()
    .default(null),
  unitPrice: z
    .object({
      cents: z.number().int().positive(),
      per: z.enum(['kg', 'l', 'un']),
    })
    .nullable(),
  promo: z
    .object({
      type: z.string().min(1),
      priceCents: z.number().int().positive(),
      description: z.string(),
    })
    .nullable(),
  categoryPath: z.array(z.string()),
  url: z.url(),
  imageUrl: z.url().nullable(),
  available: z.boolean(),
  capturedAt: z.coerce.date(),
})
export type RawOffer = z.infer<typeof rawOfferSchema>

export interface ListOffersOptions {
  /** Stop after this many listing pages (bounded/test runs). */
  maxPages?: number
}

export interface StoreProvider {
  readonly storeSlug: string
  readonly storeName: string
  readonly capabilities: {
    /** EAN is present in listing data (no enrichment needed). */
    exposesEanInListing: boolean
    /** enrichOffer can fetch extra data (e.g. EAN) for a single offer. */
    enrich: boolean
  }
  listCategories(): Promise<RawCategory[]>
  listOffers(category: RawCategory, opts?: ListOffersOptions): AsyncIterable<RawOffer>
  /** Fetch extra detail (e.g. EAN) for one offer. Must be safe to skip. */
  enrichOffer?(offer: RawOffer): Promise<RawOffer>
}

export interface ProviderOptions {
  /** Warnings about skipped/invalid items (defaults to console.warn). */
  warn?: (message: string) => void
  /** Minimum delay between requests to the same host, in ms. */
  minIntervalMs?: number
}
