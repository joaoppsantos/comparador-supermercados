import type { MatchMethod, Prisma, PrismaClient } from '@comparador/db'
import type { RawOffer } from '@comparador/providers'
import { extractQuantity, normalizeName } from './normalize.js'

export interface MatchResult {
  productId: number
  method: MatchMethod
  confidence: number
}

interface Quantity {
  value: number
  unit: 'kg' | 'l' | 'un'
}

/**
 * Package size of an offer: stated by the store (Pingo Doce) or in the name,
 * otherwise inferred from the unit price (selling price ÷ price-per-unit =
 * package size). Stores compute one from the other, so the inference is
 * stable across price changes.
 */
export function inferQuantity(offer: RawOffer): Quantity | null {
  if (offer.quantity) return offer.quantity
  const parsed = extractQuantity(offer.rawName)
  if (parsed) return { value: parsed.value, unit: parsed.unit }
  if (!offer.unitPrice) return null
  const sellingCents = offer.promo?.priceCents ?? offer.priceCents
  const value = sellingCents / offer.unitPrice.cents
  if (!Number.isFinite(value) || value <= 0) return null
  return { value: Math.round(value * 1000) / 1000, unit: offer.unitPrice.per }
}

type CandidateProduct = Prisma.ProductGetPayload<{
  include: { offers: { select: { currentPriceCents: true; currentPromoPriceCents: true; unitPriceCents: true; unitPricePer: true } } }
}>

/** Package size of an existing product: stored quantity, else inferred from any offer. */
function productQuantity(product: CandidateProduct): Quantity | null {
  if (product.quantityValue !== null && product.quantityUnit !== null) {
    return { value: Number(product.quantityValue), unit: product.quantityUnit as Quantity['unit'] }
  }
  for (const offer of product.offers) {
    if (offer.unitPriceCents === null || offer.unitPricePer === null) continue
    const sellingCents = offer.currentPromoPriceCents ?? offer.currentPriceCents
    const value = sellingCents / offer.unitPriceCents
    if (Number.isFinite(value) && value > 0) {
      return { value: Math.round(value * 1000) / 1000, unit: offer.unitPricePer as Quantity['unit'] }
    }
  }
  return null
}

/**
 * Same-name products with clearly different package sizes are variants
 * (e.g. 2/6/10-burger boxes with identical names at Continente).
 * Unknown or incomparable sizes get the benefit of the doubt.
 */
function quantitiesConflict(a: Quantity | null, b: Quantity | null): boolean {
  if (!a || !b || a.unit !== b.unit) return false
  const ratio = a.value / b.value
  return ratio < 0.8 || ratio > 1.25
}

/**
 * Phase 0 matching cascade: EAN → exact normalized tuple → create product.
 * (Fuzzy and AI matching arrive in phase 2.)
 * Exact name matches are vetoed by a conflicting EAN or a conflicting
 * (possibly unit-price-inferred) package size.
 * Decisions are persisted on the StoreOffer by the caller and never redone.
 */
export async function matchOrCreateProduct(
  prisma: PrismaClient,
  offer: RawOffer,
): Promise<MatchResult> {
  if (offer.ean) {
    const byEan = await prisma.product.findUnique({ where: { ean: offer.ean } })
    if (byEan) return { productId: byEan.id, method: 'EAN', confidence: 1 }
  }

  const brand = offer.brand?.trim() || null
  const normalizedName = normalizeName(offer.rawName, brand)
  const quantity = offer.quantity ?? extractQuantity(offer.rawName)
  const offerQty = inferQuantity(offer)

  // Quantity is deliberately not part of the lookup: stores state sizes with
  // different precision (name, explicit field, unit price), so equality is
  // checked with tolerance by the size veto below instead.
  const candidates = await prisma.product.findMany({
    where: {
      normalizedName,
      brand: brand === null ? null : { equals: brand, mode: 'insensitive' },
    },
    include: {
      offers: {
        select: {
          currentPriceCents: true,
          currentPromoPriceCents: true,
          unitPriceCents: true,
          unitPricePer: true,
        },
      },
    },
  })
  const exact = candidates.find(
    (p) =>
      (!offer.ean || !p.ean || p.ean === offer.ean) &&
      !quantitiesConflict(offerQty, productQuantity(p)),
  )
  if (exact) {
    if (offer.ean && !exact.ean) {
      await prisma.product.update({ where: { id: exact.id }, data: { ean: offer.ean } })
    }
    return { productId: exact.id, method: 'EXACT', confidence: 0.95 }
  }

  const created = await prisma.product.create({
    data: {
      ean: offer.ean,
      brand,
      name: offer.rawName,
      normalizedName,
      quantityValue: quantity?.value ?? null,
      quantityUnit: quantity?.unit ?? null,
    },
  })
  return { productId: created.id, method: 'NEW', confidence: 1 }
}
