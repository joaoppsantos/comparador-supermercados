import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { formatCents, formatQuantity } from '@/lib/format'
import { productSearchWhere } from '@/lib/productSearch'
import { storeColorVar } from '@/lib/storeColors'

export const dynamic = 'force-dynamic'

export default async function CabazMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string; store?: string; q?: string }>
}) {
  const params = await searchParams
  const entryId = Number(params.entry)
  const storeId = Number(params.store)
  if (!Number.isInteger(entryId) || !Number.isInteger(storeId)) notFound()

  const [entry, store] = await Promise.all([
    prisma.cabazEntry.findUnique({ where: { id: entryId } }),
    prisma.store.findUnique({ where: { id: storeId } }),
  ])
  if (!entry || !store) notFound()

  const existing = await prisma.cabazEntryChoice.findUnique({
    where: { entryId_storeId: { entryId, storeId } },
    include: { product: true },
  })

  // default search: the entry's first two word-tokens (the full token set is
  // usually too strict to find equivalents at other stores)
  const defaultQ = entry.tokens.filter((t) => /[a-z]/i.test(t)).slice(0, 2).join(' ')
  const q = params.q?.trim() ?? (defaultQ || entry.tokens.join(' '))
  const results = q
    ? await prisma.product.findMany({
        where: {
          AND: [productSearchWhere(q), { offers: { some: { storeId, available: true } } }],
        },
        include: { offers: { where: { storeId, available: true } } },
        orderBy: { name: 'asc' },
        take: 25,
      })
    : []

  return (
    <>
      <p className="meta">
        <Link href="/cabaz">← cabaz</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Escolher produto</h1>
      <p className="meta" style={{ marginTop: 0 }}>
        Para <strong>{entry.label}</strong> em{' '}
        <span className="dot" style={{ background: storeColorVar(store.slug), display: 'inline-block', marginRight: 5 }} />
        <strong>{store.name}</strong>
      </p>

      {existing && (
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            Escolha atual: <Link href={`/product/${existing.productId}`}>{existing.product.name}</Link>
          </span>
          <form method="post" action="/api/cabaz">
            <input type="hidden" name="action" value="unchoose" />
            <input type="hidden" name="entryId" value={entryId} />
            <input type="hidden" name="storeId" value={storeId} />
            <button className="cabaz-pick">limpar escolha</button>
          </form>
        </div>
      )}

      <form className="cabaz-add" action="/cabaz/match" style={{ margin: '14px 0' }}>
        <input type="hidden" name="entry" value={entryId} />
        <input type="hidden" name="store" value={storeId} />
        <input type="search" name="q" defaultValue={q} placeholder="procurar produto" autoFocus />
        <button type="submit">Procurar</button>
      </form>

      {q && results.length === 0 && (
        <p>Sem resultados para “{q}” em {store.name}.</p>
      )}
      {results.map((product) => {
        const effective = (o: (typeof product.offers)[number]) =>
          o.currentPromoPriceCents ?? o.currentPriceCents
        const best = [...product.offers].sort((a, b) => effective(a) - effective(b))[0]!
        const cents = effective(best)
        // package size: stated on the product, else inferred from the unit price
        const qty =
          product.quantityValue !== null && product.quantityUnit
            ? { value: Number(product.quantityValue), unit: product.quantityUnit }
            : best.unitPriceCents !== null && best.unitPricePer !== null
              ? { value: cents / best.unitPriceCents, unit: best.unitPricePer }
              : null
        return (
          <div
            className="card duel"
            key={product.id}
            style={{ gridTemplateColumns: '1fr auto auto auto' }}
          >
            <span>
              <Link href={`/product/${product.id}`}>{product.name}</Link>
              <div className="meta">
                {[
                  product.brand,
                  qty ? formatQuantity(Math.round(qty.value * 100) / 100, qty.unit) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </span>
            <span style={{ textAlign: 'right' }}>
              <span className="duel-price">{formatCents(cents)}</span>
              {best.unitPriceCents !== null && (
                <div className="meta">
                  {formatCents(best.unitPriceCents)}/{best.unitPricePer}
                </div>
              )}
            </span>
            <a
              className="cabaz-pick"
              href={best.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`ver em ${store.name}`}
              style={{ textDecoration: 'none' }}
            >
              ↗
            </a>
            <form method="post" action="/api/cabaz">
              <input type="hidden" name="action" value="choose" />
              <input type="hidden" name="entryId" value={entryId} />
              <input type="hidden" name="storeId" value={storeId} />
              <input type="hidden" name="productId" value={product.id} />
              <button type="submit" className="cabaz-pick">
                Usar este
              </button>
            </form>
          </div>
        )
      })}
    </>
  )
}
