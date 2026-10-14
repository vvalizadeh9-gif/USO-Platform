import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import AppTile from '../../shell/AppTile'
import { APPS } from '../../shell/appRegistry'
import { metaText } from './homeLogic'
import { formatNumber } from '../../lib/numbers'

// Each card is its app's: tile colour, icon and header tint from the registry.
const CARD_APP = { drive_test: 'drive-test', acceptance: 'acceptance', plans: 'monthly-plan' }
const appById = (id) => APPS.find((a) => a.id === id)

/** One queue. Every row looks the same: none is singled out as "next". */
function QueueRow({ ticket }) {
  const navigate = useNavigate()
  const meta = metaText(ticket)
  return (
    <button type="button" className="hw-row" data-queue={ticket.queue_key} onClick={() => navigate(ticket.url)}>
      <span className="hw-row-text">
        <span className="hw-row-label">{ticket.short_label}</span>
        <span className="hw-row-meta">
          {ticket.late > 0 && <span className="hw-late">{formatNumber(ticket.late)} late · </span>}
          {meta}
        </span>
      </span>
      <span className="hw-row-count">{formatNumber(ticket.count)}</span>
      <Icon name="chevron--right" size={16} />
    </button>
  )
}

/** Contractor PIP this month: delivered against target. */
function PlanProgress({ plan }) {
  const target = plan.pip || 0
  const pct = target ? Math.min(100, Math.round((plan.delivered / target) * 100)) : 0
  return (
    <div className="hw-plan">
      <div className="hw-plan-head">
        <span>Contractor PIP this month</span>
        <span>{target ? `${pct}%` : 'No plan'}</span>
      </div>
      <div className="hw-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Contractor PIP this month">
        <i style={{ '--pct': `${pct}%` }} />
      </div>
      <div className="hw-plan-line">
        {formatNumber(plan.delivered)} of {target ? formatNumber(target) : '—'} sites delivered · {formatNumber(plan.days_left)} {plan.days_left === 1 ? 'day' : 'days'} left
      </div>
    </div>
  )
}

/** A card per area of work. Hidden by the page when it has nothing to show. */
export default function WorkCard({ group, plan }) {
  const app = appById(CARD_APP[group.key])
  const total = group.tickets.reduce((s, t) => s + t.count, 0)
  const headingId = `home-card-${group.key}`
  return (
    <article className="hw-card" aria-labelledby={headingId} data-card={group.key}>
      <header className="hw-head" style={{ background: `var(${app.tint})` }}>
        <AppTile app={app} size={36} />
        <h3 id={headingId}>{group.label}</h3>
        <span className="hw-total" data-testid={`card-total-${group.key}`}>{formatNumber(total)}</span>
      </header>
      <div className="hw-rows">
        {group.tickets.map((t) => (
          <QueueRow key={t.queue_key} ticket={t} />
        ))}
      </div>
      {plan && <PlanProgress plan={plan} />}
    </article>
  )
}
