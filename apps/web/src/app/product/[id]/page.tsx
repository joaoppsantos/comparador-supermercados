import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getWishlistProductIds } from '@/lib/wishlist'
import { formatCents, formatDate, formatDateTime, formatQuantity } from '@/lib/format'
import { storeColorVar } from '@/lib/storeColors'
import { PriceHistoryChart } from '@/components/PriceHistoryChart'
import { WishlistButton } from '@/components/WishlistButton'

export const dynamic = 'force-dynamic'

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      offers: {
        include: {
          store: true,
          priceHistory: { orderBy: { capturedAt: 'asc' } },
        },
      },
    },
  })
  if (!product) notFound()
  const wishlisted = (await getWishlistProductIds()).has(product.id)

  const effective = (o: (typeof product.offers)[number]) =>
    o.currentPromoPriceCents ?? o.currentPriceCents
  const offers = [...product.offers].sort((a, b) => effective(a) - effective(b))
  const cheapest = offers.filter((o) => o.available).map(effective)[0] ?? null

  const series = offers.map((offer) => ({
    slug: offer.store.slug,
    label: offer.store.name,
    points: offer.priceHistory.map((p) => ({
      date: p.capturedAt,
      cents: p.promoPriceCents ?? p.priceCents,
    })),
  }))

  const historyRows = offers
    .flatMap((offer) =>
      offer.priceHistory.map((p) => ({
        store: offer.store.name,
        slug: offer.store.slug,
        date: p.capturedAt,
        priceCents: p.priceCents,
        promoPriceCents: p.promoPriceCents,
      })),
    )
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <>
      <p className="meta">
        <Link href="/">← pesquisa</Link>
      </p>
      <div className="card-head">
        <h1 style={{ marginBottom: 2 }}>{product.name}</h1>
        <WishlistButton productId={product.id} wishlisted={wishlisted} backTo={`/product/${product.id}`} />
      </div>
      <p className="meta" style={{ marginTop: 0 }}>
        {[
          product.brand,
          product.quantityValue !== null && product.quantityUnit
            ? formatQuantity(Number(product.quantityValue), product.quantityUnit)
            : null,
          product.ean ? `EAN ${product.ean}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <table className="data" style={{ margin: '18px 0 28px' }}>
        <thead>
          <tr>
            <th>Loja</th>
            <th>Preço</th>
            <th>Promoção</th>
            <th>Preço/unidade</th>
            <th>Visto em</th>
            <th>Confiança</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.id} style={!offer.available ? { opacity: 0.55 } : undefined}>
              <td>
                <span className="dot" style={{ background: storeColorVar(offer.store.slug), display: 'inline-block', marginRight: 7 }} />
                {offer.store.name}
                {!offer.available && <span className="muted"> (indisponível)</span>}
              </td>
              <td style={offer.available && effective(offer) === cheapest ? { color: 'var(--good)', fontWeight: 600 } : undefined}>
                {formatCents(effective(offer))}
              </td>
              <td>
                {offer.currentPromoPriceCents !== null ? (
                  <>
                    <span className="was">{formatCents(offer.currentPriceCents)}</span>{' '}
                    {offer.currentPromoType}
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {offer.unitPriceCents !== null
                  ? `${formatCents(offer.unitPriceCents)}/${offer.unitPricePer}`
                  : <span className="muted">—</span>}
              </td>
              <td>{formatDateTime(offer.lastSeenAt)}</td>
              <td className="muted">
                {offer.matchMethod} {Math.round(offer.matchConfidence * 100)}%
              </td>
              <td>
                <a href={offer.url} target="_blank" rel="noopener noreferrer">
                  ver ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Histórico de preços</h2>
      <PriceHistoryChart
        series={series}
        until={new Date(Math.max(...offers.map((o) => o.lastSeenAt.getTime())))}
      />

      <table className="data" style={{ marginTop: 18, maxWidth: 560 }}>
        <thead>
          <tr>
            <th>Data</th>
            <th>Loja</th>
            <th>Preço</th>
            <th>Promoção</th>
          </tr>
        </thead>
        <tbody>
          {historyRows.map((row, i) => (
            <tr key={i}>
              <td>{formatDate(row.date)}</td>
              <td>
                <span className="dot" style={{ background: storeColorVar(row.slug), display: 'inline-block', marginRight: 7 }} />
                {row.store}
              </td>
              <td>{formatCents(row.priceCents)}</td>
              <td>
                {row.promoPriceCents !== null ? formatCents(row.promoPriceCents) : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
