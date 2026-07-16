import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Load the repo-root .env (works whether started from the repo root or apps/worker).
for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate)
  if (existsSync(path)) {
    process.loadEnvFile(path)
    break
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  scrapeMinIntervalMs: Number(process.env.SCRAPE_MIN_INTERVAL_MS ?? 1_000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Set SCHEDULE_NIGHTLY=0 to consume queues without registering nightly scrapes. */
  scheduleNightly: process.env.SCHEDULE_NIGHTLY !== '0',
}
