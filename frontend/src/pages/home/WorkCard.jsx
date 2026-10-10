import { motion } from 'framer-motion'
import { ArrowRight, CircleCheck, Clock3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fadeUp } from '../../components/ui'
import { daysSince, daysUntil } from '../../lib/greeting'
import HomeIcon from './homeIcons'

// Each card's area: its glyph, and the colour family of its tile and header
// band (home.css, [data-area]). The colour is the area's, never a status.
const CARD_LOOK = {
  drive_test: { icon: 'car', area: 'blue' },
  acceptance: { icon: 'documentCheck', area: 'indigo' },
  plans: { icon: 'calendarBars', area: 'plum' },
}

/** The one button under a card: what the card is for. Every card's button
 * looks the same -- no queue is singled out. */
function cardAction(group, plan) {
  const top = group.tickets.find((t) => t.count > 0) || group.tickets[0]
  if (group.key === 'acceptance' && top) return { to: top.url, label: 'Open acceptance' }
  if (top) return { to: top.url, label: top.label }
  if (group.key === 'plans' && plan) return { to: '/monthly-plan', label: 'Open monthly plan' }
  return null
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The unit, in the singular for one ("1 site", "9 sites"). */
function unitText(count, unit) {
  const one = unit.endsWith('s') ? unit.slice(0, -1) : unit
  return plural(count, one, unit)
}

/** "Oldest 21 days", or for a deadline queue "Due in 3 days" / "2 days late". */
function ageText(ticket) {
  if (ticket.date_kind === 'due' && ticket.earliest_due_at) {
    const d = daysUntil(ticket.earliest_due_at)
    if (d > 1) return `Due in ${d} days`
    if (d === 1) return 'Due tomorrow'
    if (d === 0) return 'Due today'
    return `${plural(-d, 'day', 'days')} late`
  }
  if (!ticket.count || !ticket.oldest_started_at) return null
  return `Oldest ${plural(daysSince(ticket.oldest_started_at), 'day', 'days')}`
}

/** The owners, as a count; the names are one hover away. */
function ownersTitle(ticket) {
  const names = ticket.owners.join('، ')
  return ticket.owners_more ? `${names} +${ticket.owners_more} more` : names
}

/** Status is words in a tag, never a colour alone: red "late", orange
 * "due soon". */
function Tags({ ticket }) {
  return (
    <>
      {ticket.late > 0 && (
        <span className="h-tag late">
          <Clock3 size={12} aria-hidden="true" />
          {ticket.late} late
        </span>
      )}
      {ticket.due_soon > 0 && (
        <span className="h-tag soon">
          <Clock3 size={12} aria-hidden="true" />
          {ticket.due_soon} due soon
        </span>
      )}
    </>
  )
}

function QueueRow({ ticket }) {
  const age = ageText(ticket)
  const owners = ticket.owners_total || 0
  const spoken = [
    ticket.short_label,
    unitText(ticket.count, ticket.unit || 'items'),
    ticket.late ? `${ticket.late} late` : null,
    ticket.due_soon ? `${ticket.due_soon} due soon` : null,
    age ? age.toLowerCase() : null,
    owners ? plural(owners, 'owner', 'owners') : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Link to={ticket.url} className="h-q" aria-label={spoken} data-queue={ticket.queue_key}>
      {/* The name and the count own the first line, so the name is never
          squeezed into an ellipsis; tags, age and owners go on the line under. */}
      <span className="h-qt" aria-hidden="true">
        <span className="h-qn">{ticket.short_label}</span>
        <span className="h-qc">{ticket.count}</span>
      </span>
      <span className="h-qm" aria-hidden="true">
        <Tags ticket={ticket} />
        {age && <span>{age}</span>}
        {owners > 0 && (
          <span className="h-owners" title={ownersTitle(ticket)}>
            {plural(owners, 'owner', 'owners')}
          </span>
        )}
      </span>
    </Link>
  )
}

/** The running month's drive-test plan: delivered against planned. */
function PlanRow({ plan }) {
  const { pip, delivered, month_name: month, days_left: daysLeft } = plan
  const left = `${plural(daysLeft, 'day', 'days')} left`
  if (!pip) {
    return (
      <Link
        to="/monthly-plan"
        className="h-q"
        aria-label={`${month} plan: no approved plan yet, ${delivered} sites delivered, ${left}`}
      >
        <span className="h-qt" aria-hidden="true">
          <span className="h-qn">{month} plan</span>
        </span>
        <span className="h-qm" aria-hidden="true">No approved plan yet · {delivered} delivered · {left}</span>
      </Link>
    )
  }
  const pct = Math.min(100, Math.round((delivered / pip) * 100))
  return (
    <Link
      to="/monthly-plan"
      className="h-q"
      aria-label={`${month} plan: ${delivered} of ${pip} sites delivered, ${left}`}
    >
      <span className="h-qt" aria-hidden="true">
        <span className="h-qn">{month} plan</span>
      </span>
      <span className="h-plan-bar" aria-hidden="true" data-testid="plan-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="h-qm" aria-hidden="true">
        {delivered} of {pip} sites delivered · {left}
      </span>
    </Link>
  )
}

export default function WorkCard({ group, plan }) {
  const look = CARD_LOOK[group.key] || CARD_LOOK.drive_test
  const action = cardAction(group, plan)
  const headingId = `home-card-${group.key}`

  return (
    <motion.article
      className="h-card h-wc"
      data-area={look.area}
      aria-labelledby={headingId}
      variants={fadeUp}
    >
      <div className="h-ch">
        <span className="h-tile" aria-hidden="true">
          <HomeIcon name={look.icon} size={24} tone="white" />
        </span>
        <h3 className="h-ct" id={headingId}>{group.label}</h3>
        {group.scope_label && <span className="h-scope">{group.scope_label}</span>}
      </div>
      <div className="h-rows">
        {group.tickets.map((t) => (
          <QueueRow key={t.queue_key} ticket={t} />
        ))}
        {group.tickets.length === 0 && !plan && (
          <span className="h-card-empty">
            <CircleCheck size={16} aria-hidden="true" />
            Nothing waiting on you
          </span>
        )}
        {plan && <PlanRow plan={plan} />}
      </div>
      {action && (
        <div className="h-cf">
          <Link to={action.to} className="h-btn">
            <span>{action.label}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}
    </motion.article>
  )
}
