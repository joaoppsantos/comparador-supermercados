import { prisma } from '@/lib/db'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { icon: string; color: string }> = {
  RUNNING: { icon: '…', color: 'var(--text-muted)' },
  OK: { icon: '✓', color: 'var(--status-good)' },
  PARTIAL: { icon: '◑', color: 'var(--status-warning)' },
  SUSPECT: { icon: '⚠', color: 'var(--status-serious)' },
  FAILED: { icon: '✕', color: 'var(--status-critical)' },
}

export default async function RunsPage() {
  const runs = await prisma.scrapeRun.findMany({
    include: { store: true },
    orderBy: { id: 'desc' },
    take: 50,
  })

  return (
    <>
      <h1>Scrape runs</h1>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Loja</th>
            <th>Estado</th>
            <th>Ofertas</th>
            <th>Alterações</th>
            <th>Novas</th>
            <th>Erros</th>
            <th>Início</th>
            <th>Duração</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = STATUS[run.status] ?? { icon: '?', color: 'var(--text-muted)' }
            const durationMin =
              run.finishedAt !== null
                ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60_000)
                : null
            const meta = run.meta as { suspectReasons?: string[]; bounded?: boolean } | null
            return (
              <tr key={run.id}>
                <td>{run.id}</td>
                <td>{run.store.name}</td>
                <td>
                  <span className="dot" style={{ background: status.color, display: 'inline-block', marginRight: 7 }} />
                  {status.icon} {run.status}
                  {meta?.bounded ? <span className="muted"> (bounded)</span> : null}
                  {meta?.suspectReasons?.length ? (
                    <div className="meta">{meta.suspectReasons.join('; ')}</div>
                  ) : null}
                </td>
                <td>{run.offersSeen}</td>
                <td>{run.offersChanged}</td>
                <td>{run.newOffers}</td>
                <td>{run.errorCount}</td>
                <td>{formatDateTime(run.startedAt)}</td>
                <td>{durationMin !== null ? `${durationMin} min` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
