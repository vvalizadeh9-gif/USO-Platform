import { ArrowRight } from 'lucide-react'
import { Banner } from '../../components/ui'
import { count } from './format'

export default function AlertStrip({ kpis, provinces, onScrollToProvinces }) {
  const delta = kpis?.total_remaining?.delta
  if (delta == null || delta <= 0) return null

  const topGrowing = (provinces || [])
    .filter((p) => p.gap_delta > 0)
    .sort((a, b) => b.gap_delta - a.gap_delta)
    .slice(0, 2)

  const secondary =
    topGrowing.length > 0
      ? `DT completion slowed down in ${topGrowing.map((p) => `${p.name} (+${count(p.gap_delta)})`).join(' and ')}`
      : null

  // The Cobalt warning banner. `role="alert"` is kept from the strip this
  // replaces: a growing gap is news the reader should hear on arrival.
  return (
    <Banner tone="warning" role="alert" className="dt-alert-strip">
      <div className="dt-alert-row">
        <div className="dt-alert-body">
          <strong className="dt-alert-main">
            Gap increased by {count(delta)} sites this month
          </strong>
          {secondary && <span className="dt-alert-secondary dt-farsi">{secondary}</span>}
        </div>
        <button type="button" className="btn dt-alert-cta" onClick={onScrollToProvinces}>
          View province details
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </Banner>
  )
}
