import Link from 'next/link'
import { getCabazItems, resolveCabaz } from '@comparador/core'
import { prisma } from '@/lib/db'
import { formatCents, formatQuantity } from '@/lib/format'
import { productSearchWhere } from '@/lib/productSearch'
import { storeColorVar } from '@/lib/storeColors'

export const dynamic = 'force-dynamic'

export default async function CabazPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const q = (await searchParams).q?.trim() ?? ''
  const items = await getCabazItems(prisma)
  const { stores, rows, totals } = await resolveCabaz(prisma, items)

  const results = q
    ? await prisma.product.findMany({
        where: productSearchWhere(q),
        include: { offers: { where: { available: true }, include: { store: true } } },
        orderBy: { name: 'asc' },
        take: 20,
      })
    : []

  const maxCovered = Math.max(...stores.map((s) => totals[s.id]?.covered ?? 0), 0)
  const winnerId = stores
    .filter((s) => (totals[s.id]?.covered ?? 0) === maxCovered && maxCovered > 0)
    .sort((a, b) => totals[a.id]!.totalCents - totals[b.id]!.totalCents)[0]?.id

  return (
    <>
      <h1>Cabaz essencial</h1>
      <p className="meta">
        {rows.length} produtos de base comparados loja a loja. ✓ = mesmo produto e marca em várias
        lojas; ≈ = produto mais barato semelhante dessa loja; — = ainda sem dados (o catálogo cresce
        a cada scrape noturno).
      </p>

      <div className="chart-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Produto</th>
              {stores.map((store) => (
                <th key={store.id}>
                  <span
                    className="dot"
                    style={{ background: storeColorVar(store.slug), display: 'inline-block', marginRight: 6 }}
                  />
                  {store.name}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, cells }, rowIndex) => {
              const prices = stores
                .map((s) => cells[s.id]?.priceCents)
                .filter((p): p is number => typeof p === 'number')
              const cheapest = prices.length ? Math.min(...prices) : null
              const entryId = items[rowIndex]!.id
              return (
                <tr key={entryId}>
                  <td>{item.label}</td>
                  {stores.map((store) => {
                    const cell = cells[store.id]
                    if (!cell) {
                      return (
                        <td key={store.id} className="muted">
                          —
                        </td>
                      )
                    }
                    return (
                      <td
                        key={store.id}
                        style={cell.priceCents === cheapest ? { color: 'var(--good)', fontWeight: 600 } : undefined}
                      >
                        {formatCents(cell.priceCents)}{' '}
                        <span className="muted">{cell.sameProduct ? '✓' : '≈'}</span>
                        <div className="meta" style={{ fontWeight: 400 }}>
                          <Link href={`/product/${cell.productId}`}>{cell.productName}</Link>
                        </div>
                      </td>
                    )
                  })}
                  <td>
                    <form method="post" action="/api/cabaz" className="wishlist">
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="id" value={entryId} />
                      <button className="star" title="Remover do cabaz">
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              {stores.map((store) => {
                const t = totals[store.id]
                return (
                  <td key={store.id}>
                    <strong style={store.id === winnerId ? { color: 'var(--good)' } : undefined}>
                      {t && t.covered > 0 ? formatCents(t.totalCents) : '—'}
                    </strong>
                    <div className="meta">
                      {t?.covered ?? 0}/{rows.length} produtos
                    </div>
                  </td>
                )
              })}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="meta">
        Totais só somam os produtos que cada loja tem — compara lojas com cobertura semelhante.
      </p>

      <h2 style={{ marginTop: 30 }} id="add">
        Adicionar produto ao cabaz
      </h2>
      <form className="cabaz-add" action="/cabaz#add">
        <input type="search" name="q" placeholder="procurar produto (ex.: iogurte grego)" defaultValue={q} />
        <button type="submit">Procurar</button>
      </form>

      {q && results.length === 0 && <p>Sem resultados para “{q}”.</p>}
      {results.map((product) => {
        const effective = (o: (typeof product.offers)[number]) =>
          o.currentPromoPriceCents ?? o.currentPriceCents
        return (
          <div className="card duel" key={product.id} style={{ gridTemplateColumns: '1fr auto' }}>
            <span>
              <Link href={`/product/${product.id}`}>{product.name}</Link>
              <div className="meta">
                {[
                  product.brand,
                  product.quantityValue !== null && product.quantityUnit
                    ? formatQuantity(Number(product.quantityValue), product.quantityUnit)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <span className="price-chips">
                {[...product.offers]
                  .sort((a, b) => effective(a) - effective(b))
                  .map((offer) => (
                    <span key={offer.id} className="chip">
                      <span className="dot" style={{ background: storeColorVar(offer.store.slug) }} />
                      {formatCents(effective(offer))}
                    </span>
                  ))}
              </span>
            </span>
            <form method="post" action="/api/cabaz">
              <input type="hidden" name="action" value="add-product" />
              <input type="hidden" name="productId" value={product.id} />
              <button type="submit" className="cabaz-pick">
                ＋ Adicionar
              </button>
            </form>
          </div>
        )
      })}

      <details style={{ marginTop: 18 }}>
        <summary className="meta" style={{ cursor: 'pointer' }}>
          Adicionar por regra (avançado)
        </summary>
        <form method="post" action="/api/cabaz" className="cabaz-add" style={{ marginTop: 10 }}>
          <input type="hidden" name="action" value="add" />
          <input name="label" placeholder="Nome (ex.: Iogurte Grego 4x120g)" required />
          <input name="tokens" placeholder="palavras a procurar (ex.: iogurte grego)" required />
          <input name="qtyValue" placeholder="qtd (ex.: 0,48)" inputMode="decimal" size={8} />
          <select name="qtyUnit" defaultValue="">
            <option value="">sem tamanho</option>
            <option value="kg">kg</option>
            <option value="l">l</option>
            <option value="un">un</option>
          </select>
          <button type="submit">Adicionar</button>
        </form>
        <p className="meta">
          As palavras têm de aparecer todas no nome do produto; o tamanho (±30%) evita comparar
          embalagens diferentes.
        </p>
      </details>
    </>
  )
}
