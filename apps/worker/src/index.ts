import { createPipeline } from './pipeline.js'
import { logger } from './logger.js'

// Long-lived worker process: consumes jobs and keeps the nightly schedule.
const pipeline = createPipeline()
const workers = pipeline.startWorkers()

// Staggered nightly full scrapes (one scheduler entry per store).
const NIGHTLY: Array<[slug: string, cron: string]> = [
  ['continente', '0 2 * * *'],
  ['auchan', '30 3 * * *'],
  ['pingo-doce', '0 5 * * *'],
]
for (const [storeSlug, pattern] of NIGHTLY) {
  await pipeline.storeQueue.upsertJobScheduler(
    `nightly-${storeSlug}`,
    { pattern, tz: 'Europe/Lisbon' },
    { name: 'scrape-store', data: { storeSlug } },
  )
}

logger.info('worker up: queues consuming, nightly schedule registered')

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  await pipeline.close(workers)
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
