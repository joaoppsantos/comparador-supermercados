import Link from 'next/link'
import { resolveCabaz } from '@comparador/core'
import { prisma } from '@/lib/db'
import { formatCents } from '@/lib/format'
import { storeColorVar } from '@/lib/storeColors'

export const dynamic = 'force-dynamic'

export default async function CabazPage() {
  const { stores, rows, totals } = await resolveCabaz(prisma)

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
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, cells }) => {
              const prices = stores
                .map((s) => cells[s.id]?.priceCents)
                .filter((p): p is number => typeof p === 'number')
              const cheapest = prices.length ? Math.min(...prices) : null
              return (
                <tr key={item.label}>
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
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="meta">
        Totais só somam os produtos que cada loja tem — compara lojas com cobertura semelhante.
      </p>
    </>
  )
}
