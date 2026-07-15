import { parseArgs } from 'node:util'
import { QueueEvents } from 'bullmq'
import { knownProviderSlugs } from '@comparador/providers'
import { logger } from './logger.js'
import { createPipeline, redisConnection, QUEUE_STORE } from './pipeline.js'

// One-shot scrape: boots the workers in-process, runs a store scrape to
// completion, prints the run summary, and exits.
//
//   pnpm scrape continente
//   pnpm scrape continente --categories laticinios,mercearia-arroz --max-pages 2

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    categories: { type: 'string' },
    'max-pages': { type: 'string' },
  },
})

const storeSlug = positionals[0]
if (!storeSlug) {
  console.error(`Usage: pnpm scrape <store> [--categories a,b] [--max-pages N]`)
  console.error(`Known stores: ${knownProviderSlugs().join(', ')}`)
  process.exit(2)
}

const maxPages = values['max-pages'] === undefined ? undefined : Number(values['max-pages'])
if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
  console.error('--max-pages must be a positive integer')
  process.exit(2)
}

const pipeline = createPipeline()
const workers = pipeline.startWorkers()
const storeEvents = new QueueEvents(QUEUE_STORE, { connection: redisConnection() })
await storeEvents.waitUntilReady()

const job = await pipeline.enqueueStoreScrape({
  storeSlug,
  categories: values.categories?.split(',').map((s) => s.trim()).filter(Boolean),
  maxPages,
})
const { runId } = (await job.waitUntilFinished(storeEvents)) as { runId: number }
logger.info({ runId }, 'run started, waiting for categories + finalize')

const TIMEOUT_MS = 3 * 60 * 60 * 1_000
const startedWaiting = Date.now()
let run = await pipeline.prisma.scrapeRun.findUniqueOrThrow({ where: { id: runId } })
while (run.status === 'RUNNING') {
  if (Date.now() - startedWaiting > TIMEOUT_MS) {
    logger.error({ runId }, 'timed out waiting for run to finish')
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  run = await pipeline.prisma.scrapeRun.findUniqueOrThrow({ where: { id: runId } })
}

console.log(
  JSON.stringify(
    {
      runId: run.id,
      status: run.status,
      offersSeen: run.offersSeen,
      offersChanged: run.offersChanged,
      newOffers: run.newOffers,
      errorCount: run.errorCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    null,
    2,
  ),
)

await storeEvents.close()
await pipeline.close(workers)
process.exit(run.status === 'OK' || run.status === 'PARTIAL' ? 0 : 1)
