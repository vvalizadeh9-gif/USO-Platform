import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import AppTile from '../../shell/AppTile'
import { APPS } from '../../shell/appRegistry'
import { AREA_MEASURES, fmtCount, fmtRate } from '../reports/rolesPerformance/model'
import { formatNumber } from '../../lib/numbers'

/** The four village counts the region landing shows, in the Area tab's order. */
export const REGION_MEASURES = AREA_MEASURES.filter((m) => ['onair', 'dt', 'ict', 'cra'].includes(m.key))

const INSIGHTS = APPS.find((a) => a.id === 'insights')

/** Roles Performance › My area, opened on one measure. The server confines a
 * Regional manager to their own region, so the link needs no scope of its own. */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export const areaLink = (measure) => `/reports/kpi/area?measure=${encodeURIComponent(measure)}`

/**
 * The Regional manager's landing (UEP role access §5a): their region today, as
 * Roles Performance › My area counts it -- the same GET /kpi/area, no new
 * calculation. Each row opens that tab on its measure. Built from Home's work
 * card: header, rows, counts.
 */
export default function RegionSummary({ data }) {
  return (
    <section className="hw-section" aria-labelledby="home-region">
      <div className="hw-title">
        <h2 id="home-region">Your region</h2>
        <span>Villages · today, as Roles performance counts them</span>
      </div>
      <article className="hw-card" aria-labelledby="home-region-card" data-card="region">
        <header className="hw-head" style={{ background: 'var(--uep-accent-tint)' }}>
          <AppTile app={INSIGHTS} size={36} />
          <h3 id="home-region-card">{data.scope.label}</h3>
          <span className="hw-total" data-testid="region-total">{formatNumber(data.totals.villages)}</span>
        </header>
        <div className="hw-rows">
          {REGION_MEASURES.map((m) => {
            const measure = data.totals[m.key]
            return (
              <Link key={m.key} className="hw-row" to={areaLink(m.key)} data-measure={m.key}>
                <span className="hw-row-text">
                  <span className="hw-row-label">{m.label}</span>
                  <span className="hw-row-meta">
                    {fmtRate(measure.rate)} of villages · national {fmtRate(data.national[m.key])}
                  </span>
                </span>
                <span className="hw-row-count">{fmtCount(measure.count)}</span>
                <Icon name="chevron--right" size={16} />
              </Link>
            )
          })}
        </div>
      </article>
    </section>
  )
}
