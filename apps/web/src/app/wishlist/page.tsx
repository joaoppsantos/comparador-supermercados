import Link from 'next/link'
import { prisma } from '@/lib/db'
import { WISHLIST_NAME } from '@/lib/wishlist'
import { ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'

export default async function WishlistPage() {
  const items = await prisma.shoppingListItem.findMany({
    where: { list: { name: WISHLIST_NAME } },
    include: { product: { include: { offers: { include: { store: true } } } } },
    orderBy: { id: 'desc' },
  })

  return (
    <>
      <h1>Wishlist</h1>
      {items.length === 0 && (
        <p>
          Ainda não há produtos na wishlist. <Link href="/">Pesquisar produtos</Link> e marcar com ☆.
        </p>
      )}
      {items.map((item) => (
        <ProductCard key={item.id} product={item.product} wishlisted backTo="/wishlist" />
      ))}
    </>
  )
}
