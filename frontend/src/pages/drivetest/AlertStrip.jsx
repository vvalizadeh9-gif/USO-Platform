import { AlertTriangle, ArrowRight } from 'lucide-react'
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

  return (
    <div className="dt-alert-strip" role="alert">
      <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
      <div className="dt-alert-body">
        <span className="dt-alert-main">
          Gap increased by {count(delta)} sites this month
        </span>
        {secondary && <span className="dt-alert-secondary dt-farsi">{secondary}</span>}
      </div>
      <button
        type="button"
        className="dt-alert-cta"
        onClick={onScrollToProvinces}
      >
        View province details
        <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
