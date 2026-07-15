import type { PrismaClient } from '@comparador/db'
import { stripAccents } from './normalize.js'

export interface CabazItem {
  label: string
  /** All tokens must appear in the product's normalizedName. */
  tokens: string[]
  /** Expected package size; candidates outside ±30% are rejected. */
  targetQty?: { value: number; unit: 'kg' | 'l' | 'un' }
  /** Entry created by picking a concrete product: pin it as the anchor. */
  anchorProductId?: number
}

/** Essential-goods basket (DECO-style), sized to typical reference formats. */
export const DEFAULT_CABAZ: CabazItem[] = [
  { label: 'Leite UHT Meio Gordo 1 L', tokens: ['leite', 'uht', 'meio', 'gordo'], targetQty: { value: 1, unit: 'l' } },
  { label: 'Ovos (dúzia)', tokens: ['ovos'], targetQty: { value: 12, unit: 'un' } },
  { label: 'Arroz Agulha 1 kg', tokens: ['arroz', 'agulha'], targetQty: { value: 1, unit: 'kg' } },
  { label: 'Esparguete 500 g', tokens: ['esparguete'], targetQty: { value: 0.5, unit: 'kg' } },
  { label: 'Açúcar 1 kg', tokens: ['acucar'], targetQty: { value: 1, unit: 'kg' } },
  { label: 'Farinha de Trigo 1 kg', tokens: ['farinha', 'trigo'], targetQty: { value: 1, unit: 'kg' } },
  { label: 'Azeite Virgem Extra 750 ml', tokens: ['azeite', 'virgem', 'extra'], targetQty: { value: 0.75, unit: 'l' } },
  { label: 'Atum em Óleo (lata)', tokens: ['atum', 'oleo'], targetQty: { value: 0.11, unit: 'kg' } },
  { label: 'Manteiga 250 g', tokens: ['manteiga'], targetQty: { value: 0.25, unit: 'kg' } },
  { label: 'Café Moído 250 g', tokens: ['cafe', 'moido'], targetQty: { value: 0.25, unit: 'kg' } },
  { label: 'Água sem Gás (garrafão 5–7 L)', tokens: ['agua', 'sem', 'gas'], targetQty: { value: 5.4, unit: 'l' } },
  { label: 'Papel Higiénico', tokens: ['papel', 'higienico'] },
]

export interface StoredCabazItem extends CabazItem {
  id: number
}

/**
 * The basket lives in the database so it is editable in the app; on first use
 * it is seeded with the default essential basket.
 */
export async function getCabazItems(prisma: PrismaClient): Promise<StoredCabazItem[]> {
  const count = await prisma.cabazEntry.count()
  if (count === 0) {
    await prisma.cabazEntry.createMany({
      data: DEFAULT_CABAZ.map((item, i) => ({
        label: item.label,
        tokens: item.tokens,
        targetQtyValue: item.targetQty?.value ?? null,
        targetQtyUnit: item.targetQty?.unit ?? null,
        position: i,
      })),
    })
  }
  const entries = await prisma.cabazEntry.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] })
  return entries.map((e) => ({
    id: e.id,
    label: e.label,
    tokens: e.tokens,
    ...(e.targetQtyValue !== null && e.targetQtyUnit !== null
      ? { targetQty: { value: Number(e.targetQtyValue), unit: e.targetQtyUnit as 'kg' | 'l' | 'un' } }
      : {}),
    ...(e.productId !== null ? { anchorProductId: e.productId } : {}),
  }))
}

const VALID_UNITS = new Set(['kg', 'l', 'un'])

/**
 * Creates a basket entry from a picked product: label and search tokens come
 * from the product, its package size (stated or inferred from unit price)
 * becomes the target, and the product itself is pinned as anchor.
 */
export async function addCabazEntryForProduct(
  prisma: PrismaClient,
  productId: number,
): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      brand: true,
      normalizedName: true,
      quantityValue: true,
      quantityUnit: true,
      offers: {
        where: { available: true },
        select: {
          storeId: true,
          currentPriceCents: true,
          currentPromoPriceCents: true,
          unitPriceCents: true,
          unitPricePer: true,
        },
      },
    },
  })
  if (!product) return false
  const tokens = product.normalizedName.split(' ').filter(Boolean)
  if (tokens.length === 0) return false

  const qty = candidateQty(product)
  const hasQty = qty !== null && VALID_UNITS.has(qty.unit)
  const label =
    product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase())
      ? `${product.name} ${product.brand}`
      : product.name

  const last = await prisma.cabazEntry.aggregate({ _max: { position: true } })
  await prisma.cabazEntry.create({
    data: {
      label,
      tokens,
      targetQtyValue: hasQty ? Math.round(qty.value * 1000) / 1000 : null,
      targetQtyUnit: hasQty ? qty.unit : null,
      productId: product.id,
      position: (last._max.position ?? 0) + 1,
    },
  })
  return true
}

export interface CabazCell {
  productId: number
  productName: string
  priceCents: number
  /** True when this is the same canonical product chosen for the other stores. */
  sameProduct: boolean
  /** True when the user picked this product for this store by hand. */
  manual?: boolean
}

export interface ResolvedCabaz {
  stores: Array<{ id: number; slug: string; name: string }>
  rows: Array<{ item: CabazItem; cells: Record<number, CabazCell | null> }>
  totals: Record<number, { totalCents: number; covered: number }>
}

type Candidate = {
  id: number
  name: string
  quantityValue: unknown
  quantityUnit: string | null
  offers: Array<{
    storeId: number
    currentPriceCents: number
    currentPromoPriceCents: number | null
    unitPriceCents: number | null
    unitPricePer: string | null
  }>
}

function effectiveCents(offer: Candidate['offers'][number]): number {
  return offer.currentPromoPriceCents ?? offer.currentPriceCents
}

/** Package size: stored quantity, else inferred from an offer's unit price. */
function candidateQty(product: Candidate): { value: number; unit: string } | null {
  if (product.quantityValue !== null && product.quantityUnit !== null) {
    return { value: Number(product.quantityValue), unit: product.quantityUnit }
  }
  for (const offer of product.offers) {
    if (offer.unitPriceCents === null || offer.unitPricePer === null) continue
    const value = effectiveCents(offer) / offer.unitPriceCents
    if (Number.isFinite(value) && value > 0) return { value, unit: offer.unitPricePer }
  }
  return null
}

function fitsTarget(product: Candidate, target: CabazItem['targetQty']): boolean {
  if (!target) return true
  const qty = candidateQty(product)
  if (!qty) return false // unknown size can't be compared like-for-like
  if (qty.unit !== target.unit) return false
  const ratio = qty.value / target.value
  return ratio >= 0.7 && ratio <= 1.3
}

/**
 * Resolves the basket: per item, prefer one canonical product available in as
 * many stores as possible (same product + brand everywhere); stores it does
 * not cover fall back to their cheapest similar product, marked as such.
 */
export async function resolveCabaz(
  prisma: PrismaClient,
  items: Array<CabazItem & { id?: number }> = DEFAULT_CABAZ,
): Promise<ResolvedCabaz> {
  const stores = await prisma.store.findMany({ orderBy: { slug: 'asc' } })
  const rows: ResolvedCabaz['rows'] = []

  // manual per-store picks override whatever the automatic resolution finds
  const entryIds = items.map((i) => i.id).filter((id): id is number => id !== undefined)
  const choices = entryIds.length
    ? await prisma.cabazEntryChoice.findMany({
        where: { entryId: { in: entryIds } },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              offers: {
                where: { available: true },
                select: { storeId: true, currentPriceCents: true, currentPromoPriceCents: true },
              },
            },
          },
        },
      })
    : []
  const choiceByEntryStore = new Map(choices.map((c) => [`${c.entryId}:${c.storeId}`, c]))

  for (const item of items) {
    const tokens = item.tokens.map((t) => stripAccents(t.toLowerCase()))
    const candidates: Candidate[] = await prisma.product.findMany({
      where: {
        AND: tokens.map((token) => ({ normalizedName: { contains: token } })),
        offers: { some: { available: true } },
      },
      select: {
        id: true,
        name: true,
        quantityValue: true,
        quantityUnit: true,
        offers: {
          where: { available: true },
          select: {
            storeId: true,
            currentPriceCents: true,
            currentPromoPriceCents: true,
            unitPriceCents: true,
            unitPricePer: true,
          },
        },
      },
    })
    const fitting = candidates.filter((c) => fitsTarget(c, item.targetQty))

    // cheapest offer per store for one candidate
    const bestPerStore = (c: Candidate) => {
      const best = new Map<number, number>()
      for (const offer of c.offers) {
        const cents = effectiveCents(offer)
        if (cents < (best.get(offer.storeId) ?? Infinity)) best.set(offer.storeId, cents)
      }
      return best
    }

    // anchor: a pinned product wins outright; otherwise the candidate sold in
    // the most stores (tie: cheapest on average)
    let anchor: Candidate | null = null
    let anchorBest = new Map<number, number>()
    const pinned = item.anchorProductId
      ? (fitting.find((c) => c.id === item.anchorProductId) ?? null)
      : null
    if (pinned) {
      anchor = pinned
      anchorBest = bestPerStore(pinned)
    } else {
      for (const candidate of fitting) {
        const best = bestPerStore(candidate)
        const better =
          !anchor ||
          best.size > anchorBest.size ||
          (best.size === anchorBest.size &&
            [...best.values()].reduce((a, b) => a + b, 0) / best.size <
              [...anchorBest.values()].reduce((a, b) => a + b, 0) / anchorBest.size)
        if (better) {
          anchor = candidate
          anchorBest = best
        }
      }
    }
    // a pinned anchor is used even when only one store sells it
    const anchorIsShared = pinned !== null ? anchorBest.size >= 1 : anchorBest.size >= 2

    const cells: Record<number, CabazCell | null> = {}
    for (const store of stores) {
      const choice = item.id !== undefined ? choiceByEntryStore.get(`${item.id}:${store.id}`) : undefined
      if (choice) {
        const storeOffers = choice.product.offers.filter((o) => o.storeId === store.id)
        if (storeOffers.length > 0) {
          cells[store.id] = {
            productId: choice.product.id,
            productName: choice.product.name,
            priceCents: Math.min(
              ...storeOffers.map((o) => o.currentPromoPriceCents ?? o.currentPriceCents),
            ),
            sameProduct: true,
            manual: true,
          }
          continue
        }
      }
      const anchorPrice = anchorBest.get(store.id)
      if (anchor && anchorIsShared && anchorPrice !== undefined) {
        cells[store.id] = {
          productId: anchor.id,
          productName: anchor.name,
          priceCents: anchorPrice,
          sameProduct: true,
        }
        continue
      }
      // similar fallback: cheapest fitting product in this store
      let fallback: CabazCell | null = null
      for (const candidate of fitting) {
        const price = bestPerStore(candidate).get(store.id)
        if (price !== undefined && price < (fallback?.priceCents ?? Infinity)) {
          fallback = {
            productId: candidate.id,
            productName: candidate.name,
            priceCents: price,
            sameProduct: false,
          }
        }
      }
      cells[store.id] = fallback
    }
    rows.push({ item, cells })
  }

  const totals: ResolvedCabaz['totals'] = {}
  for (const store of stores) {
    let totalCents = 0
    let covered = 0
    for (const row of rows) {
      const cell = row.cells[store.id]
      if (!cell) continue
      covered++
      totalCents += cell.priceCents
    }
    totals[store.id] = { totalCents, covered }
  }

  return { stores, rows, totals }
}
