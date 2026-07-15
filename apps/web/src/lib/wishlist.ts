import { prisma } from './db'

export const WISHLIST_NAME = 'Wishlist'

export async function getWishlistProductIds(): Promise<Set<number>> {
  const items = await prisma.shoppingListItem.findMany({
    where: { list: { name: WISHLIST_NAME } },
    select: { productId: true },
  })
  return new Set(items.map((item) => item.productId))
}
