import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

let singleton: PrismaClient | undefined

/** Shared client for app code (reads DATABASE_URL from the environment). */
export function getPrisma(): PrismaClient {
  singleton ??= new PrismaClient()
  return singleton
}

/** Independent client for tests or scripts that target another database. */
export function createPrisma(datasourceUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl })
}
