import { CheckCheck, Hourglass, Radio, RadioTower } from 'lucide-react'
import { KpiCard } from '../../../components/ui'
import { DrillFigure } from '../AcceptanceDrillPanel'
import CardFailed from './CardFailed'
import { buildKpis, fmt } from './model'

const ICONS = { onair: RadioTower, dt_done: Radio, approved: CheckCheck, remaining: Hourglass }

/**
 * The KPI band for one tab: four cards on Village; on ICT and CRA the fourth,
 * Remaining, is double width and split into Rejected and Waiting for
 * feedback, which add up to it.
 *
 * Every figure opens the villages behind it (the drill panel), with the
 * authority when the figure is one authority's. Cards are the Cobalt KPI
 * card: a neutral chip, the 15/22 title, the 30/38 figure with its share at
 * the end of the line, and a 6px bar. Nothing else goes in a card.
 */
export default function KpiBand({ state, stream }) {
  const split = stream !== 'village'
  if (state.error) {
    return (
      <section className="accd-kpis accd-kpis-failed" aria-label="Acceptance totals">
        <CardFailed what="the totals" error={state.error} onRetry={state.retry} />
      </section>
    )
  }
  if (!state.data) {
    return (
      <section className={`accd-kpis${split ? ' is-split' : ''}`} aria-label="Acceptance totals" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="kpi-card accd-skeleton" data-testid="kpi-skeleton" />
        ))}
      </section>
    )
  }

  const cards = buildKpis(state.data, stream)
  return (
    <section className={`accd-kpis${split ? ' is-split' : ''}`} aria-label="Acceptance totals">
      {cards.map((card) => (
        <Kpi key={card.key} card={card} />
      ))}
    </section>
  )
}

function Kpi({ card }) {
  const figure = (
    <DrillFigure
      metric={card.drill.metric}
      authority={card.drill.authority}
      label={card.drill.label}
      value={card.figure}
      className="accd-figure tnum"
    />
  )
  const body = (
    <KpiCard
      icon={ICONS[card.icon]}
      title={card.title}
      figure={figure}
      aside={card.context}
      className="accd-kpi"
      data-kpi={card.key}
    >
      <span className="accd-bar" aria-hidden="true">
        <i style={{ width: `${card.bar.share}%`, background: card.bar.color }} />
      </span>
    </KpiCard>
  )
  if (!card.tiles) return body
  return (
    <div className="accd-kpi-wide" data-kpi-wide={card.key}>
      {body}
      <div className="accd-tiles">
        {card.tiles.map((tile) => (
          <div key={tile.key} className="accd-tile" data-tile={tile.key}>
            <span className="accd-tile-title">
              <i className="accd-dot" style={{ background: tile.dot }} aria-hidden="true" />
              {tile.title}
            </span>
            <span className="accd-tile-line">
              <DrillFigure
                metric={tile.drill.metric}
                authority={tile.drill.authority}
                label={tile.drill.label}
                value={tile.figure}
                className="accd-tile-figure tnum"
              >
                {fmt(tile.figure)}
              </DrillFigure>
              {tile.context && <span className="accd-tile-context">{tile.context}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
