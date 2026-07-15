import type { PrismaClient } from '@comparador/db'
import { rawOfferSchema } from '@comparador/providers'
import { matchOrCreateProduct } from './matching.js'

export interface IngestStats {
  offersSeen: number
  offersChanged: number
  newOffers: number
}

/**
 * Moves a run's staged offers into the real tables.
 * - known offer, same price → bump lastSeenAt/availability only
 * - known offer, price or promo changed → one new PricePoint + update
 * - unknown offer → matching cascade, create StoreOffer + first PricePoint
 * Idempotent: re-running for the same staging data writes no duplicates.
 */
export async function ingestStagedRun(prisma: PrismaClient, runId: number): Promise<IngestStats> {
  const run = await prisma.scrapeRun.findUniqueOrThrow({ where: { id: runId } })
  const stats: IngestStats = { offersSeen: 0, offersChanged: 0, newOffers: 0 }

  let cursor: number | undefined
  for (;;) {
    const batch = await prisma.stagingOffer.findMany({
      where: { runId },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    })
    if (batch.length === 0) break
    cursor = batch[batch.length - 1]!.id

    for (const row of batch) {
      const offer = rawOfferSchema.parse(row.payload)
      stats.offersSeen++
      const promoCents = offer.promo?.priceCents ?? null
      const promoType = offer.promo?.type ?? null

      const existing = await prisma.storeOffer.findUnique({
        where: { storeId_externalId: { storeId: run.storeId, externalId: offer.externalId } },
      })

      if (existing) {
        const priceChanged =
          existing.currentPriceCents !== offer.priceCents ||
          existing.currentPromoPriceCents !== promoCents ||
          existing.currentPromoType !== promoType
        if (priceChanged) stats.offersChanged++

        await prisma.$transaction([
          ...(priceChanged
            ? [
                prisma.pricePoint.create({
                  data: {
                    offerId: existing.id,
                    priceCents: offer.priceCents,
                    promoPriceCents: promoCents,
                    promoType,
                    capturedAt: offer.capturedAt,
                  },
                }),
              ]
            : []),
          prisma.storeOffer.update({
            where: { id: existing.id },
            data: {
              currentPriceCents: offer.priceCents,
              currentPromoPriceCents: promoCents,
              currentPromoType: promoType,
              unitPriceCents: offer.unitPrice?.cents ?? null,
              unitPricePer: offer.unitPrice?.per ?? null,
              available: offer.available,
              lastSeenAt: offer.capturedAt,
              url: offer.url,
              imageUrl: offer.imageUrl,
              categoryPath: offer.categoryPath.join('/') || null,
            },
          }),
        ])
        continue
      }

      stats.newOffers++
      const match = await matchOrCreateProduct(prisma, offer)
      await prisma.storeOffer.create({
        data: {
          storeId: run.storeId,
          productId: match.productId,
          externalId: offer.externalId,
          url: offer.url,
          imageUrl: offer.imageUrl,
          categoryPath: offer.categoryPath.join('/') || null,
          available: offer.available,
          currentPriceCents: offer.priceCents,
          currentPromoPriceCents: promoCents,
          currentPromoType: promoType,
          unitPriceCents: offer.unitPrice?.cents ?? null,
          unitPricePer: offer.unitPrice?.per ?? null,
          lastSeenAt: offer.capturedAt,
          matchMethod: match.method,
          matchConfidence: match.confidence,
          priceHistory: {
            create: {
              priceCents: offer.priceCents,
              promoPriceCents: promoCents,
              promoType,
              capturedAt: offer.capturedAt,
            },
          },
        },
      })
    }
  }
  return stats
}

/** Offers not seen by a full-coverage run are no longer on the site. */
export async function markUnseenUnavailable(
  prisma: PrismaClient,
  storeId: number,
  runStartedAt: Date,
): Promise<number> {
  const res = await prisma.storeOffer.updateMany({
    where: { storeId, available: true, lastSeenAt: { lt: runStartedAt } },
    data: { available: false },
  })
  return res.count
}
