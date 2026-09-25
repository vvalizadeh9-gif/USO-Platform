import { WASH } from './acceptanceTheme'

/** A KPI card's icon + label + sub, shared by every KPI card on the
 * Acceptance Dashboard — including `PlanTargetCard`, which lives in its own
 * file because it also carries the PM's set-target form. */
export function KpiHeader({ icon: Icon, iconColor, label, sub }) {
  return (
    <div className="row" style={{ gap: 9 }}>
      <span
        style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: WASH[iconColor] || 'var(--surface-3)',
          color: iconColor, display: 'grid', placeItems: 'center',
        }}
      >
        <Icon size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap' }}>{label}</div>
        <div className="dim" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
    </div>
  )
}
