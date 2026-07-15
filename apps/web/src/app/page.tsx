import Link from 'next/link'
import { prisma } from '@/lib/db'
import { productSearchWhere } from '@/lib/productSearch'
import { topCategories } from '@/lib/categories'
import { getWishlistProductIds } from '@/lib/wishlist'
import { distinctStoreCount, ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string }>
}) {
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const cat = params.cat?.trim() ?? ''

  const textFilter = q ? [productSearchWhere(q)] : []
  const categoryFilter = cat
    ? [{ offers: { some: { categoryPath: { contains: cat, mode: 'insensitive' as const } } } }]
    : []

  const matches =
    q || cat
      ? await prisma.product.findMany({
          where: { AND: [...textFilter, ...categoryFilter] },
          include: { offers: { include: { store: true } } },
          orderBy: { name: 'asc' },
          take: 200,
        })
      : []

  // products compared across more stores come first
  const products = matches
    .sort(
      (a, b) =>
        distinctStoreCount(b) - distinctStoreCount(a) || a.name.localeCompare(b.name, 'pt'),
    )
    .slice(0, 50)

  const [categories, wishlistIds] = await Promise.all([
    topCategories(),
    q || cat ? getWishlistProductIds() : Promise.resolve(new Set<number>()),
  ])

  const [productCount, offerCount] =
    q || cat ? [null, null] : await Promise.all([prisma.product.count(), prisma.storeOffer.count()])

  const backTo = `/?${new URLSearchParams({ ...(q && { q }), ...(cat && { cat }) })}`

  return (
    <>
      <h1>Pesquisa de preços</h1>
      <form className="search-form" action="/">
        <input
          type="search"
          name="q"
          placeholder="ex.: leite mimosa, ovos, 5601312508007"
          defaultValue={q}
          autoFocus
        />
        {cat && <input type="hidden" name="cat" value={cat} />}
      </form>

      <div className="cat-chips">
        {cat && (
          <Link href={q ? `/?q=${encodeURIComponent(q)}` : '/'} className="cat-chip clear">
            ✕ {cat}
          </Link>
        )}
        {categories
          .filter((c) => c.label !== cat)
          .map((c) => (
            <Link
              key={c.label}
              href={`/?${new URLSearchParams({ ...(q && { q }), cat: c.label })}`}
              className="cat-chip"
            >
              {c.label} <span className="muted">{c.productCount}</span>
            </Link>
          ))}
      </div>

      {!q && !cat && (
        <p className="meta" style={{ marginTop: 16 }}>
          {productCount} produtos · {offerCount} ofertas na base de dados
        </p>
      )}

      {(q || cat) && products.length === 0 && (
        <p style={{ marginTop: 24 }}>Sem resultados{q ? ` para “${q}”` : ''}{cat ? ` em ${cat}` : ''}.</p>
      )}

      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          wishlisted={wishlistIds.has(product.id)}
          backTo={backTo}
        />
      ))}
    </>
  )
}
