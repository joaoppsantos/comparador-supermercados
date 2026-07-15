import { prisma } from './db'

export interface CategoryChip {
  label: string
  productCount: number
}

/**
 * Browse chips derived from the stores' own category paths (the canonical
 * taxonomy is a phase-2 item). The most informative level differs per store:
 * Continente/Auchan paths are deep ("Bebidas e Garrafeira/Sumos e
 * Refrigerantes/…" → 2nd segment), Pingo Doce's are a single leaf.
 */
export async function topCategories(limit = 18): Promise<CategoryChip[]> {
  const offers = await prisma.storeOffer.findMany({
    where: { categoryPath: { not: null } },
    select: { categoryPath: true, productId: true },
  })
  const byLabel = new Map<string, Set<number>>()
  for (const offer of offers) {
    const segments = offer.categoryPath!.split('/')
    const label = (segments.length >= 2 ? segments[1] : segments[0])?.trim()
    if (!label) continue
    const ids = byLabel.get(label)
    if (ids) ids.add(offer.productId)
    else byLabel.set(label, new Set([offer.productId]))
  }
  return [...byLabel.entries()]
    .map(([label, ids]) => ({ label, productCount: ids.size }))
    .sort((a, b) => b.productCount - a.productCount || a.label.localeCompare(b.label, 'pt'))
    .slice(0, limit)
}
