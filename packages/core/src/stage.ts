import type { PrismaClient } from '@comparador/db'
import type { RawCategory, StoreProvider } from '@comparador/providers'

/**
 * Scrapes one category into the staging table. Network work happens here;
 * ingestion into the real tables is a separate, DB-only step (finalize).
 * Upserts make retries of a failed category job idempotent.
 */
export async function stageCategory(
  prisma: PrismaClient,
  provider: StoreProvider,
  args: {
    runId: number
    storeId: number
    category: RawCategory
    maxPages?: number
  },
): Promise<{ staged: number }> {
  let staged = 0
  for await (const offer of provider.listOffers(args.category, { maxPages: args.maxPages })) {
    let enriched = offer
    if (!offer.ean && provider.capabilities.enrich && provider.enrichOffer) {
      // Detail pages are only worth a request for offers we've never seen.
      const known = await prisma.storeOffer.findUnique({
        where: {
          storeId_externalId: { storeId: args.storeId, externalId: offer.externalId },
        },
        select: { id: true },
      })
      if (!known) enriched = await provider.enrichOffer(offer)
    }
    // Dates → ISO strings for the Json column.
    const payload = JSON.parse(JSON.stringify(enriched)) as object
    await prisma.stagingOffer.upsert({
      where: { runId_externalId: { runId: args.runId, externalId: enriched.externalId } },
      create: { runId: args.runId, externalId: enriched.externalId, payload },
      update: { payload },
    })
    staged++
  }
  return { staged }
}
