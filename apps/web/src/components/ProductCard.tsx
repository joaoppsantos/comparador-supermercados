import Link from 'next/link'
import type { Prisma } from '@comparador/db'
import { formatCents, formatQuantity } from '@/lib/format'
import { storeColorVar } from '@/lib/storeColors'
import { WishlistButton } from './WishlistButton'

export type ProductWithOffers = Prisma.ProductGetPayload<{
  include: { offers: { include: { store: true } } }
}>

export function distinctStoreCount(product: ProductWithOffers): number {
  return new Set(product.offers.map((o) => o.storeId)).size
}

export function ProductCard({
  product,
  wishlisted,
  backTo,
}: {
  product: ProductWithOffers
  wishlisted: boolean
  backTo: string
}) {
  const effective = (o: ProductWithOffers['offers'][number]) =>
    o.currentPromoPriceCents ?? o.currentPriceCents
  const available = product.offers.filter((o) => o.available)
  const cheapest = available.length ? Math.min(...available.map(effective)) : null

  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <Link href={`/product/${product.id}`}>{product.name}</Link>
        </h3>
        <WishlistButton productId={product.id} wishlisted={wishlisted} backTo={backTo} />
      </div>
      <div className="meta">
        {[
          product.brand,
          product.quantityValue !== null && product.quantityUnit
            ? formatQuantity(Number(product.quantityValue), product.quantityUnit)
            : null,
          product.ean ? `EAN ${product.ean}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div className="price-chips">
        {[...product.offers]
          .sort((a, b) => effective(a) - effective(b))
          .map((offer) => (
            <span
              key={offer.id}
              className={`chip${offer.available && effective(offer) === cheapest ? ' cheapest' : ''}`}
              style={!offer.available ? { opacity: 0.55 } : undefined}
            >
              <span className="dot" style={{ background: storeColorVar(offer.store.slug) }} />
              {offer.store.name}
              <span className="price">{formatCents(effective(offer))}</span>
              {offer.currentPromoPriceCents !== null && (
                <span className="was">{formatCents(offer.currentPriceCents)}</span>
              )}
              {offer.unitPriceCents !== null && (
                <span className="unit">
                  {formatCents(offer.unitPriceCents)}/{offer.unitPricePer}
                </span>
              )}
              {!offer.available && <span className="muted">indisponível</span>}
            </span>
          ))}
      </div>
    </div>
  )
}
