import { parseArgs } from 'node:util'
import { QueueEvents } from 'bullmq'
import { knownProviderSlugs } from '@comparador/providers'
import { logger } from './logger.js'
import { createPipeline, redisConnection, QUEUE_STORE } from './pipeline.js'

// One-shot scrape: boots the workers in-process, runs the store scrape(s) to
// completion, prints the run summaries, and exits. Multiple stores run in
// parallel (politeness is per host).
//
//   pnpm scrape continente
//   pnpm scrape continente auchan
//   pnpm scrape continente --categories laticinios,mercearia-arroz --max-pages 2

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    categories: { type: 'string' },
    'max-pages': { type: 'string' },
  },
})

const storeSlugs = positionals
if (storeSlugs.length === 0) {
  console.error(`Usage: pnpm scrape <store...> [--categories a,b] [--max-pages N]`)
  console.error(`Known stores: ${knownProviderSlugs().join(', ')}`)
  process.exit(2)
}
const unknown = storeSlugs.filter((s) => !knownProviderSlugs().includes(s))
if (unknown.length > 0) {
  console.error(`Unknown stores: ${unknown.join(', ')} (known: ${knownProviderSlugs().join(', ')})`)
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

const jobs = await Promise.all(
  storeSlugs.map((storeSlug) =>
    pipeline.enqueueStoreScrape({
      storeSlug,
      categories: values.categories?.split(',').map((s) => s.trim()).filter(Boolean),
      maxPages,
    }),
  ),
)
const runIds = await Promise.all(
  jobs.map(async (job) => ((await job.waitUntilFinished(storeEvents)) as { runId: number }).runId),
)
logger.info({ runIds }, 'runs started, waiting for categories + finalize')

const TIMEOUT_MS = 24 * 60 * 60 * 1_000
const startedWaiting = Date.now()
let runs = await pipeline.prisma.scrapeRun.findMany({ where: { id: { in: runIds } } })
while (runs.some((r) => r.status === 'RUNNING')) {
  if (Date.now() - startedWaiting > TIMEOUT_MS) {
    logger.error({ runIds }, 'timed out waiting for runs to finish')
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  runs = await pipeline.prisma.scrapeRun.findMany({ where: { id: { in: runIds } } })
}

console.log(
  JSON.stringify(
    runs.map((run) => ({
      runId: run.id,
      status: run.status,
      offersSeen: run.offersSeen,
      offersChanged: run.offersChanged,
      newOffers: run.newOffers,
      errorCount: run.errorCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
    null,
    2,
  ),
)

await storeEvents.close()
await pipeline.close(workers)
process.exit(runs.every((run) => run.status === 'OK' || run.status === 'PARTIAL') ? 0 : 1)
