import { KpiSkeleton } from '../../drivetest/KpiBand'
import { DrillFigure } from '../AcceptanceDrillPanel'
import CardFailed from './CardFailed'
import { buildKpis, fmt } from './model'

/**
 * The KPI strip for one tab: the Drive test dashboard's dense strip (one
 * white container, four equal tiles), each tile its label, the figure,
 * exactly one 18px line, and its visual pinned to the bottom. No sparklines.
 *
 * Every figure opens the villages behind it (the drill panel), with the
 * authority when the figure is one authority's. On Remaining the line is two
 * more figures -- rejected and waiting -- each opening its own list; the
 * stacked bar under it is the same split.
 *
 * `thisMonth` is the running month's approvals for the stream, from
 * /progress; null while that loads or fails, and the line leaves it out.
 */
export default function KpiBand({ state, stream, thisMonth }) {
  if (state.error) {
    return (
      <section className="acc-kpis-failed" aria-label="Acceptance totals">
        <CardFailed what="the totals" error={state.error} onRetry={state.retry} />
      </section>
    )
  }
  if (!state.data) {
    return (
      <section aria-label="Acceptance totals" aria-busy="true" data-testid="kpi-skeleton">
        <KpiSkeleton />
      </section>
    )
  }

  const tiles = buildKpis(state.data, stream, { thisMonth })
  return (
    <section className="hk-strip dt-kpi-band acc-kpis" aria-label="Acceptance totals">
      {tiles.map((tile, i) => (
        <Tile key={tile.key} tile={tile} index={i} />
      ))}
    </section>
  )
}

function Tile({ tile, index }) {
  return (
    <div className="hk-tile dt-kpi-card" data-kpi={tile.key} style={{ '--i': index }}>
      <span className="hk-label dt-kpi-title">{tile.title}</span>
      <DrillFigure
        metric={tile.drill.metric}
        authority={tile.drill.authority}
        label={tile.drill.label}
        value={tile.figure}
        className="hk-value dt-kpi-figure tnum"
      />
      <span className="dt-kpi-change" data-testid="kpi-line">
        {tile.line.map((part, i) => (
          <LinePart key={i} part={part} first={i === 0} />
        ))}
      </span>
      <Visual visual={tile.visual} />
    </div>
  )
}

/** One clause of a tile's line: words, or a figure that opens its list. */
function LinePart({ part, first }) {
  const sep = first ? null : <span aria-hidden="true">·</span>
  if (part.drill) {
    return (
      <>
        {sep}
        <span className="acc-line-fig">
          <DrillFigure
            metric={part.drill.metric}
            authority={part.drill.authority}
            label={part.drill.label}
            value={part.figure}
            className={`tnum acc-tone-${part.figure === 0 ? 'zero' : part.tone}`}
          >
            <b>{fmt(part.figure)}</b>
          </DrillFigure>
          <span>{part.text}</span>
        </span>
      </>
    )
  }
  return (
    <>
      {sep}
      <span>{part.text}</span>
    </>
  )
}

function Visual({ visual }) {
  if (!visual) return null
  if (visual.stack) {
    return (
      <div className="dt-kpi-split acc-kpi-visual" role="img" aria-label={visual.label}>
        {visual.stack
          .filter((seg) => seg.share > 0)
          .map((seg) => (
            <i key={seg.key} data-seg={seg.key} style={{ width: `${seg.share}%`, background: seg.color }} />
          ))}
      </div>
    )
  }
  return (
    <span className="acc-meter acc-kpi-visual" aria-hidden="true">
      <i style={{ width: `${visual.meter}%` }} />
    </span>
  )
}
