import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPrisma } from '@comparador/db'

// Next.js only loads .env from the app directory; ours lives at the repo root.
if (!process.env.DATABASE_URL) {
  for (const candidate of ['.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate)
    if (existsSync(path)) {
      process.loadEnvFile(path)
      break
    }
  }
}

export const prisma = getPrisma()
