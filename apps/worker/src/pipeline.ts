import { FlowProducer, Queue, Worker, type Job } from 'bullmq'
import { getPrisma } from '@comparador/db'
import { getProvider, type RawCategory } from '@comparador/providers'
import { finalizeRun, stageCategory } from '@comparador/core'
import { env } from './env.js'
import { logger } from './logger.js'

export const QUEUE_STORE = 'scrape-store'
export const QUEUE_CATEGORY = 'scrape-category'
export const QUEUE_FINALIZE = 'finalize-run'

/** BullMQ creates and owns its Redis connections from these options. */
export function redisConnection() {
  const u = new URL(env.redisUrl)
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    maxRetriesPerRequest: null,
  }
}

export interface StoreJobData {
  storeSlug: string
  /** Restrict to these category externalIds (bounded run). */
  categories?: string[]
  /** Cap listing pages per category (bounded run). */
  maxPages?: number
}

interface CategoryJobData {
  runId: number
  storeId: number
  storeSlug: string
  category: RawCategory
  maxPages: number | null
}

interface FinalizeJobData {
  runId: number
  storeSlug: string
}

export function createPipeline() {
  const connection = redisConnection()
  const prisma = getPrisma()
  const flow = new FlowProducer({ connection })
  const storeQueue = new Queue(QUEUE_STORE, { connection })

  function providerFor(slug: string) {
    return getProvider(slug, {
      minIntervalMs: env.scrapeMinIntervalMs,
      warn: (msg) => logger.warn({ store: slug }, msg),
    })
  }

  /** Orchestrator: creates the ScrapeRun and fans out one job per category. */
  async function processStoreJob(job: Job): Promise<{ runId: number }> {
    const data = job.data as StoreJobData
    const provider = providerFor(data.storeSlug)
    const store = await prisma.store.upsert({
      where: { slug: data.storeSlug },
      create: { slug: data.storeSlug, name: provider.storeName },
      update: {},
    })

    let categories = await provider.listCategories()
    if (data.categories?.length) {
      const wanted = new Set(data.categories)
      categories = categories.filter((c) => wanted.has(c.externalId))
    }
    if (categories.length === 0) throw new Error(`no categories to scrape for ${data.storeSlug}`)

    const bounded = Boolean(data.categories?.length) || data.maxPages !== undefined
    const run = await prisma.scrapeRun.create({
      data: {
        storeId: store.id,
        meta: {
          planned: categories.map((c) => c.externalId),
          bounded,
          maxPages: data.maxPages ?? null,
        },
      },
    })
    logger.info(
      { runId: run.id, store: data.storeSlug, categories: categories.length, bounded },
      'scrape run created',
    )

    await flow.add({
      name: `finalize-${data.storeSlug}-${run.id}`,
      queueName: QUEUE_FINALIZE,
      data: { runId: run.id, storeSlug: data.storeSlug } satisfies FinalizeJobData,
      opts: { attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
      children: categories.map((category) => ({
        name: `cat-${category.externalId}`,
        queueName: QUEUE_CATEGORY,
        data: {
          runId: run.id,
          storeId: store.id,
          storeSlug: data.storeSlug,
          category,
          maxPages: data.maxPages ?? null,
        } satisfies CategoryJobData,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          // A category that keeps failing must not block the run forever;
          // finalize counts the failures and downgrades the run status.
          ignoreDependencyOnFailure: true,
        },
      })),
    })
    return { runId: run.id }
  }

  async function processCategoryJob(job: Job): Promise<{ staged: number }> {
    const { runId, storeId, storeSlug, category, maxPages } = job.data as CategoryJobData
    const provider = providerFor(storeSlug)
    const { staged } = await stageCategory(prisma, provider, {
      runId,
      storeId,
      category,
      maxPages: maxPages ?? undefined,
    })
    logger.info({ runId, store: storeSlug, category: category.externalId, staged }, 'category staged')
    return { staged }
  }

  async function processFinalizeJob(job: Job) {
    const { runId, storeSlug } = job.data as FinalizeJobData
    const failedChildren = await job.getFailedChildrenValues()
    const categoriesFailed = Object.keys(failedChildren ?? {}).length
    const run = await finalizeRun(prisma, runId, { categoriesFailed })

    const summary = {
      runId: run.id,
      store: storeSlug,
      status: run.status,
      offersSeen: run.offersSeen,
      offersChanged: run.offersChanged,
      newOffers: run.newOffers,
      categoriesFailed,
    }
    if (run.status === 'OK' || run.status === 'PARTIAL') logger.info(summary, 'run finalized')
    else logger.error(summary, 'run quarantined/failed')
    return summary
  }

  function startWorkers(): Worker[] {
    const opts = { connection, concurrency: 1 }
    return [
      new Worker(QUEUE_STORE, processStoreJob, opts),
      new Worker(QUEUE_CATEGORY, processCategoryJob, opts),
      new Worker(QUEUE_FINALIZE, processFinalizeJob, opts),
    ]
  }

  async function enqueueStoreScrape(data: StoreJobData): Promise<Job> {
    return storeQueue.add('scrape-store', data, { attempts: 1 })
  }

  async function close(workers: Worker[] = []): Promise<void> {
    await Promise.all(workers.map((w) => w.close()))
    await flow.close()
    await storeQueue.close()
    await prisma.$disconnect()
  }

  return { prisma, storeQueue, startWorkers, enqueueStoreScrape, close }
}
