import { z } from 'zod'
import type { PrismaClient, ScrapeRun } from '@comparador/db'
import { ingestStagedRun, markUnseenUnavailable } from './ingest.js'

export const runMetaSchema = z.object({
  planned: z.array(z.string()).default([]),
  bounded: z.boolean().default(false),
  maxPages: z.number().int().nullable().optional(),
  suspectReasons: z.array(z.string()).optional(),
  categoriesFailed: z.number().int().optional(),
})
export type RunMeta = z.infer<typeof runMetaSchema>

/**
 * Pure sanity check: catches the classic broken-scraper signatures before any
 * staged data touches the real tables.
 */
export function evaluateRunSanity(input: {
  offersStaged: number
  prospectiveNew: number
  previousOffersSeen: number | null
}): string[] {
  const reasons: string[] = []
  if (input.offersStaged === 0) {
    reasons.push('zero offers staged')
    return reasons
  }
  if (input.previousOffersSeen !== null && input.previousOffersSeen > 0) {
    const ratio = input.offersStaged / input.previousOffersSeen
    if (ratio < 0.6) {
      reasons.push(
        `offers dropped to ${Math.round(ratio * 100)}% of previous run (${input.offersStaged}/${input.previousOffersSeen})`,
      )
    }
    const newShare = input.prospectiveNew / input.offersStaged
    if (newShare > 0.3) {
      reasons.push(
        `anomalous share of never-seen offers: ${Math.round(newShare * 100)}% (${input.prospectiveNew}/${input.offersStaged})`,
      )
    }
  }
  return reasons
}

async function countProspectiveNew(
  prisma: PrismaClient,
  storeId: number,
  runId: number,
): Promise<number> {
  let prospectiveNew = 0
  let cursor: number | undefined
  for (;;) {
    const batch = await prisma.stagingOffer.findMany({
      where: { runId },
      orderBy: { id: 'asc' },
      take: 1000,
      select: { id: true, externalId: true },
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    })
    if (batch.length === 0) break
    cursor = batch[batch.length - 1]!.id
    const known = await prisma.storeOffer.count({
      where: { storeId, externalId: { in: batch.map((r) => r.externalId) } },
    })
    prospectiveNew += batch.length - known
  }
  return prospectiveNew
}

/** offersSeen of the most recent full-coverage (non-bounded) ingested run. */
async function findPreviousFullRunOffersSeen(
  prisma: PrismaClient,
  storeId: number,
  runId: number,
): Promise<number | null> {
  const candidates = await prisma.scrapeRun.findMany({
    where: { storeId, id: { lt: runId }, status: { in: ['OK', 'PARTIAL'] } },
    orderBy: { id: 'desc' },
    take: 10,
  })
  for (const candidate of candidates) {
    if (!runMetaSchema.parse(candidate.meta ?? {}).bounded) return candidate.offersSeen
  }
  return null
}

/**
 * Closes a run: sanity checks → quarantine (SUSPECT, staging kept) or
 * ingest → availability sweep (full-coverage runs only) → staging cleanup.
 * Bounded runs (category subset / page cap) skip sanity checks and the sweep:
 * partial coverage is expected there by design.
 */
export async function finalizeRun(
  prisma: PrismaClient,
  runId: number,
  opts: { categoriesFailed?: number } = {},
): Promise<ScrapeRun> {
  const run = await prisma.scrapeRun.findUniqueOrThrow({ where: { id: runId } })
  const meta = runMetaSchema.parse(run.meta ?? {})
  const categoriesFailed = opts.categoriesFailed ?? 0
  const offersStaged = await prisma.stagingOffer.count({ where: { runId } })

  if (offersStaged === 0 && categoriesFailed > 0 && categoriesFailed >= meta.planned.length) {
    return prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorCount: categoriesFailed,
        meta: { ...meta, categoriesFailed },
      },
    })
  }

  if (!meta.bounded) {
    const reasons = evaluateRunSanity({
      offersStaged,
      prospectiveNew: await countProspectiveNew(prisma, run.storeId, runId),
      previousOffersSeen: await findPreviousFullRunOffersSeen(prisma, run.storeId, runId),
    })
    if (reasons.length > 0) {
      // Quarantine: staging rows are kept for inspection, nothing is ingested.
      return prisma.scrapeRun.update({
        where: { id: runId },
        data: {
          status: 'SUSPECT',
          finishedAt: new Date(),
          offersSeen: offersStaged,
          errorCount: categoriesFailed,
          meta: { ...meta, suspectReasons: reasons, categoriesFailed },
        },
      })
    }
  }

  const stats = await ingestStagedRun(prisma, runId)
  if (!meta.bounded && categoriesFailed === 0) {
    await markUnseenUnavailable(prisma, run.storeId, run.startedAt)
  }
  await prisma.stagingOffer.deleteMany({ where: { runId } })

  return prisma.scrapeRun.update({
    where: { id: runId },
    data: {
      status: categoriesFailed > 0 ? 'PARTIAL' : 'OK',
      finishedAt: new Date(),
      offersSeen: stats.offersSeen,
      offersChanged: stats.offersChanged,
      newOffers: stats.newOffers,
      errorCount: categoriesFailed,
      meta: { ...meta, categoriesFailed },
    },
  })
}
