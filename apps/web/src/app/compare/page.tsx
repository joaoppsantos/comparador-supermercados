import Link from 'next/link'
import { prisma } from '@/lib/db'
import { topCategories } from '@/lib/categories'
import { formatCents } from '@/lib/format'
import { seededShuffle, dailySeed } from '@/lib/seededShuffle'
import { storeColorVar } from '@/lib/storeColors'
import { WISHLIST_NAME } from '@/lib/wishlist'

export const dynamic = 'force-dynamic'

const SAMPLE_SIZE = 8

interface SharedProduct {
  id: number
  name: string
  priceA: number
  priceB: number
}

function compareHref(a: string, b: string, cat: string, seed?: number): string {
  const params = new URLSearchParams({ a, b, ...(cat && { cat }) })
  if (seed !== undefined) params.set('seed', String(seed))
  return `/compare?${params}`
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; cat?: string; seed?: string }>
}) {
  const params = await searchParams
  const stores = await prisma.store.findMany({ orderBy: { slug: 'asc' } })
  const bySlug = new Map(stores.map((s) => [s.slug, s]))

  const storeA = bySlug.get(params.a ?? '') ?? bySlug.get('continente') ?? stores[0]
  const storeB =
    (bySlug.get(params.b ?? '') !== storeA ? bySlug.get(params.b ?? '') : undefined) ??
    stores.find((s) => s !== storeA)
  if (!storeA || !storeB) {
    return <p>São precisas pelo menos duas lojas com dados. Corre primeiro um scrape.</p>
  }
  const cat = params.cat?.trim() ?? ''
  const seed = Number.parseInt(params.seed ?? '', 10) || dailySeed()

  // fair basis: only products both stores currently sell
  const products = await prisma.product.findMany({
    where: {
      AND: [
        { offers: { some: { storeId: storeA.id, available: true } } },
        { offers: { some: { storeId: storeB.id, available: true } } },
        ...(cat
          ? [{ offers: { some: { categoryPath: { contains: cat, mode: 'insensitive' as const } } } }]
          : []),
      ],
    },
    include: { offers: { where: { available: true } } },
  })

  const shared: SharedProduct[] = []
  for (const product of products) {
    const effective = (storeId: number) => {
      const offers = product.offers.filter((o) => o.storeId === storeId)
      if (offers.length === 0) return null
      return Math.min(...offers.map((o) => o.currentPromoPriceCents ?? o.currentPriceCents))
    }
    const priceA = effective(storeA.id)
    const priceB = effective(storeB.id)
    if (priceA !== null && priceB !== null) {
      shared.push({ id: product.id, name: product.name, priceA, priceB })
    }
  }

  const winsA = shared.filter((p) => p.priceA < p.priceB).length
  const winsB = shared.filter((p) => p.priceB < p.priceA).length
  const ties = shared.length - winsA - winsB
  const totalA = shared.reduce((sum, p) => sum + p.priceA, 0)
  const totalB = shared.reduce((sum, p) => sum + p.priceB, 0)
  const gapPct =
    totalA && totalB
      ? Math.round(Math.abs(totalA / totalB - 1) * 1000) / 10
      : 0
  const cheaperStore = totalA < totalB ? storeA : totalB < totalA ? storeB : null

  const sample = seededShuffle(shared, seed).slice(0, SAMPLE_SIZE)

  const pairs: Array<[typeof storeA, typeof storeB]> = []
  for (let i = 0; i < stores.length; i++) {
    for (let j = i + 1; j < stores.length; j++) pairs.push([stores[i]!, stores[j]!])
  }

  const categories = await topCategories()

  // wishlist basket priced at every store
  const wishlistItems = await prisma.shoppingListItem.findMany({
    where: { list: { name: WISHLIST_NAME } },
    include: { product: { include: { offers: { where: { available: true } } } } },
  })
  const basket = stores.map((store) => {
    let totalCents = 0
    let covered = 0
    for (const item of wishlistItems) {
      const offers = item.product.offers.filter((o) => o.storeId === store.id)
      if (offers.length === 0) continue
      covered++
      totalCents +=
        Math.min(...offers.map((o) => o.currentPromoPriceCents ?? o.currentPriceCents)) *
        item.quantity
    }
    return { store, totalCents, covered }
  })

  return (
    <>
      <h1>Duelo de supermercados</h1>

      <div className="cat-chips">
        {pairs.map(([a, b]) => {
          const active = (a === storeA && b === storeB) || (a === storeB && b === storeA)
          return (
            <Link
              key={`${a.slug}-${b.slug}`}
              href={compareHref(a.slug, b.slug, cat)}
              className={`cat-chip${active ? ' clear' : ''}`}
            >
              {a.name} vs {b.name}
            </Link>
          )
        })}
      </div>

      <div className="cat-chips">
        {cat && (
          <Link href={compareHref(storeA.slug, storeB.slug, '')} className="cat-chip clear">
            ✕ {cat}
          </Link>
        )}
        {categories
          .filter((c) => c.label !== cat)
          .map((c) => (
            <Link
              key={c.label}
              href={compareHref(storeA.slug, storeB.slug, c.label)}
              className="cat-chip"
            >
              {c.label}
            </Link>
          ))}
      </div>

      {shared.length === 0 ? (
        <p style={{ marginTop: 24 }}>
          Sem produtos em comum entre {storeA.name} e {storeB.name}
          {cat ? ` em ${cat}` : ''}. (O matching cruzado cresce a cada scrape.)
        </p>
      ) : (
        <>
          <div className="card scoreboard">
            <div className="scoreboard-row">
              <span className="side" style={{ color: storeColorVar(storeA.slug) }}>
                <strong>{storeA.name}</strong> · ganha {winsA}
              </span>
              <span className="muted">{ties} empates</span>
              <span className="side" style={{ color: storeColorVar(storeB.slug) }}>
                ganha {winsB} · <strong>{storeB.name}</strong>
              </span>
            </div>
            <p className="meta" style={{ margin: '8px 0 0', textAlign: 'center' }}>
              Cesta com os {shared.length} produtos em comum{cat ? ` de ${cat}` : ''}:{' '}
              <strong>{formatCents(totalA)}</strong> vs <strong>{formatCents(totalB)}</strong>
              {cheaperStore && (
                <>
                  {' '}
                  — <strong style={{ color: 'var(--good)' }}>{cheaperStore.name}</strong> é{' '}
                  {gapPct.toLocaleString('pt-PT')}% mais barato nesta cesta
                </>
              )}
            </p>
          </div>

          <div className="card-head" style={{ marginTop: 22 }}>
            <h2 style={{ margin: 0 }}>
              {Math.min(SAMPLE_SIZE, shared.length)} duelos aleatórios
            </h2>
            <Link className="cat-chip" href={compareHref(storeA.slug, storeB.slug, cat, seed + 1)}>
              ⟳ Baralhar
            </Link>
          </div>

          {sample.map((p) => {
            const aWins = p.priceA < p.priceB
            const bWins = p.priceB < p.priceA
            const diff =
              aWins || bWins
                ? Math.round((Math.max(p.priceA, p.priceB) / Math.min(p.priceA, p.priceB) - 1) * 100)
                : 0
            return (
              <div className="card duel" key={p.id}>
                <span className={`duel-price${aWins ? ' win' : ''}`}>
                  <span className="dot" style={{ background: storeColorVar(storeA.slug) }} />
                  {formatCents(p.priceA)}
                </span>
                <span className="duel-name">
                  <Link href={`/product/${p.id}`}>{p.name}</Link>
                  {diff > 0 && <span className="meta"> diferença {diff}%</span>}
                </span>
                <span className={`duel-price right${bWins ? ' win' : ''}`}>
                  {formatCents(p.priceB)}
                  <span className="dot" style={{ background: storeColorVar(storeB.slug) }} />
                </span>
              </div>
            )
          })}
        </>
      )}

      {wishlistItems.length > 0 && (
        <>
          <h2 style={{ marginTop: 34 }}>A tua wishlist em cada loja</h2>
          <table className="data" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th>Loja</th>
                <th>Total</th>
                <th>Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {[...basket]
                .sort((x, y) =>
                  y.covered - x.covered !== 0 ? y.covered - x.covered : x.totalCents - y.totalCents,
                )
                .map(({ store, totalCents, covered }) => (
                  <tr key={store.id}>
                    <td>
                      <span
                        className="dot"
                        style={{ background: storeColorVar(store.slug), display: 'inline-block', marginRight: 7 }}
                      />
                      {store.name}
                    </td>
                    <td>{covered > 0 ? formatCents(totalCents) : <span className="muted">—</span>}</td>
                    <td className="muted">
                      {covered}/{wishlistItems.length} produtos
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="meta">
            Totais apenas sobre os produtos que cada loja tem — compara lojas com cobertura
            semelhante.
          </p>
        </>
      )}
    </>
  )
}
