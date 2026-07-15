import type { Prisma } from '@comparador/db'

/** Search filter shared by the main search and the cabaz product picker. */
export function productSearchWhere(q: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { ean: q },
      // multi-word queries: every word must appear in name or brand
      ...(q.includes(' ')
        ? [
            {
              AND: q.split(/\s+/).map((word) => ({
                OR: [
                  { name: { contains: word, mode: 'insensitive' as const } },
                  { brand: { contains: word, mode: 'insensitive' as const } },
                ],
              })),
            },
          ]
        : []),
    ],
  }
}
