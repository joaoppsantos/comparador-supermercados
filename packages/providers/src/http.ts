const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const RETRY_DELAYS_MS = [2_000, 8_000, 20_000]

const lastRequestAt = new Map<string, number>()
const hostLocks = new Map<string, Promise<void>>()

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpStatusError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits for this host's next polite slot. Concurrent callers are chained on a
 * per-host promise so the interval holds even with parallel jobs.
 */
async function acquireHostSlot(host: string, minIntervalMs: number): Promise<void> {
  const previous = hostLocks.get(host) ?? Promise.resolve()
  let release!: () => void
  hostLocks.set(
    host,
    new Promise((resolve) => {
      release = resolve
    }),
  )
  await previous
  const waitMs = (lastRequestAt.get(host) ?? 0) + minIntervalMs - Date.now()
  if (waitMs > 0) await sleep(waitMs)
  lastRequestAt.set(host, Date.now())
  release()
}

/**
 * fetch() with per-host politeness (min interval between requests) and
 * retries with backoff + jitter on 429/5xx/network errors.
 * 4xx (other than 429) throws immediately — retrying won't help.
 */
export async function politeFetch(
  url: string,
  opts: { minIntervalMs?: number } = {},
): Promise<string> {
  const minIntervalMs = opts.minIntervalMs ?? 1_000
  const host = new URL(url).host

  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    await acquireHostSlot(host, minIntervalMs)

    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'pt-PT,pt;q=0.9',
        },
        signal: AbortSignal.timeout(45_000),
      })
      if (res.ok) return await res.text()
      if (res.status !== 429 && res.status < 500) {
        throw new HttpStatusError(res.status, url)
      }
      lastError = new HttpStatusError(res.status, url)
    } catch (err) {
      if (err instanceof HttpStatusError) throw err
      lastError = err
    }

    const delay = RETRY_DELAYS_MS[attempt]
    if (delay === undefined) break
    await sleep(delay + Math.random() * 1_000)
  }
  throw lastError
}
