import { formatCents } from '@/lib/format'
import { storeColorVar } from '@/lib/storeColors'

export interface ChartSeries {
  slug: string
  label: string
  /** Price changes, ascending by date; each price holds until the next point. */
  points: { date: Date; cents: number }[]
}

const W = 760
const H = 300
const M = { top: 14, right: 128, bottom: 30, left: 56 }

/**
 * Server-rendered step chart (prices hold until they change, so steps are the
 * honest form). Hover detail comes from native <title> tooltips on the change
 * markers; the page pairs this with a legend, direct labels and a table view.
 *
 * `until` (typically the offers' max lastSeenAt) sets the right edge. It must
 * be derived from data, never from the clock: the render has to be
 * deterministic or the two dev render passes produce mismatching SVG
 * coordinates and React reports hydration attribute errors.
 */
export function PriceHistoryChart({ series, until }: { series: ChartSeries[]; until: Date }) {
  const drawable = series.filter((s) => s.points.length > 0)
  if (drawable.length === 0) return null

  const allPoints = drawable.flatMap((s) => s.points)
  const now = Math.max(until.getTime(), ...allPoints.map((p) => p.date.getTime()))
  let tMin = Math.min(...allPoints.map((p) => p.date.getTime()))
  if (now - tMin < 86_400_000) tMin = now - 86_400_000
  const centsValues = allPoints.map((p) => p.cents)
  let yMin = Math.min(...centsValues)
  let yMax = Math.max(...centsValues)
  const pad = Math.max((yMax - yMin) * 0.12, yMax * 0.05, 5)
  yMin = Math.max(0, yMin - pad)
  yMax = yMax + pad

  const x = (t: number) => M.left + ((t - tMin) / (now - tMin)) * (W - M.left - M.right)
  const y = (c: number) => M.top + (1 - (c - yMin) / (yMax - yMin)) * (H - M.top - M.bottom)

  const yTicks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * (i + 0.5)) / 4)
  const xTicks = [0, 1, 2, 3].map((i) => tMin + ((now - tMin) * (i + 0.5)) / 4)

  // direct labels at line ends, nudged apart when they collide
  const labels = drawable
    .map((s) => ({
      slug: s.slug,
      label: s.label,
      cents: s.points[s.points.length - 1]!.cents,
      y: y(s.points[s.points.length - 1]!.cents),
    }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i]!.y - labels[i - 1]!.y < 16) labels[i]!.y = labels[i - 1]!.y + 16
  }

  return (
    <figure style={{ margin: 0 }}>
      {drawable.length >= 2 && (
        <div className="legend">
          {drawable.map((s) => (
            <span className="item" key={s.slug}>
              <span className="dot" style={{ background: storeColorVar(s.slug) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-wrap">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Histórico de preços por supermercado"
          style={{ background: 'var(--surface-1)', borderRadius: 10, maxWidth: '100%' }}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={M.left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {formatCents(Math.round(tick))}
              </text>
            </g>
          ))}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={H - M.bottom}
            y2={H - M.bottom}
            stroke="var(--baseline)"
            strokeWidth={1}
          />
          {xTicks.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {new Date(tick).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}
            </text>
          ))}

          {drawable.map((s) => {
            const color = storeColorVar(s.slug)
            const first = s.points[0]!
            let d = `M ${x(first.date.getTime()).toFixed(1)} ${y(first.cents).toFixed(1)}`
            for (let i = 1; i < s.points.length; i++) {
              const p = s.points[i]!
              d += ` H ${x(p.date.getTime()).toFixed(1)} V ${y(p.cents).toFixed(1)}`
            }
            d += ` H ${(W - M.right).toFixed(1)}`
            return (
              <g key={s.slug}>
                <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                {s.points.map((p) => (
                  <circle
                    key={p.date.getTime()}
                    cx={x(p.date.getTime())}
                    cy={y(p.cents)}
                    r={4}
                    fill={color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  >
                    <title>
                      {`${s.label} · ${p.date.toLocaleDateString('pt-PT')} · ${formatCents(p.cents)}`}
                    </title>
                  </circle>
                ))}
              </g>
            )
          })}

          {labels.map((label) => (
            <g key={label.slug}>
              <circle
                cx={W - M.right + 10}
                cy={label.y - 4}
                r={4}
                fill={storeColorVar(label.slug)}
              />
              <text
                x={W - M.right + 20}
                y={label.y}
                fontSize={12}
                fill="var(--text-secondary)"
              >
                {label.label} {formatCents(label.cents)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  )
}
