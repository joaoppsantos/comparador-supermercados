import { afterEach, describe, expect, it, vi } from 'vitest'
import { politeFetch } from '../src/http.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('politeFetch', () => {
  it('keeps the per-host interval even under concurrent callers', async () => {
    const timestamps: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        timestamps.push(Date.now())
        return new Response('ok', { status: 200 })
      }),
    )

    await Promise.all([
      politeFetch('https://same-host.test/a', { minIntervalMs: 60 }),
      politeFetch('https://same-host.test/b', { minIntervalMs: 60 }),
      politeFetch('https://same-host.test/c', { minIntervalMs: 60 }),
    ])

    timestamps.sort((a, b) => a - b)
    expect(timestamps).toHaveLength(3)
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]! - timestamps[i - 1]!).toBeGreaterThanOrEqual(55) // small timer slack
    }
  })

  it('does not serialize requests across different hosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    const start = Date.now()
    await Promise.all([
      politeFetch('https://host-a.test/', { minIntervalMs: 150 }),
      politeFetch('https://host-b.test/', { minIntervalMs: 150 }),
      politeFetch('https://host-c.test/', { minIntervalMs: 150 }),
    ])
    expect(Date.now() - start).toBeLessThan(140)
  })
})
