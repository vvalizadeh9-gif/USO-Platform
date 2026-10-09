import { motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, CarFront, Check, CircleCheck, Clock3, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import ItemDots from '../../components/ItemDots'
import { dotsLabel } from '../../lib/itemDots'
import { fadeUp } from '../../components/ui'
import { daysSince, daysUntil } from '../../lib/greeting'

// Each card's soft round icon. The tint is the card's, never a status.
const CARD_LOOK = {
  drive_test: { icon: CarFront, tint: 'blue' },
  acceptance: { icon: BadgeCheck, tint: 'violet' },
  plans: { icon: CalendarDays, tint: 'teal' },
}

/** Above this many planned sites the plan is a meter, not a dot per site. */
const PLAN_DOTS_MAX = 100

/** "Oldest 21 days", or for a deadline queue "Due in 3 days" / "2 days late". */
function ageText(ticket) {
  if (ticket.date_kind === 'due' && ticket.earliest_due_at) {
    const d = daysUntil(ticket.earliest_due_at)
    if (d > 1) return `Due in ${d} days`
    if (d === 1) return 'Due tomorrow'
    if (d === 0) return 'Due today'
    return `${-d} ${d === -1 ? 'day' : 'days'} late`
  }
  if (!ticket.oldest_started_at) return null
  const d = daysSince(ticket.oldest_started_at)
  return `Oldest ${d} ${d === 1 ? 'day' : 'days'}`
}

/** The status tag beside a queue's name: always words and an icon, never
 * colour alone. */
function StatusTag({ ticket }) {
  if (ticket.late > 0) {
    return (
      <span className="h-tag late">
        <Clock3 size={12} strokeWidth={2.5} aria-hidden="true" />
        {ticket.late} late
      </span>
    )
  }
  if (ticket.due_soon > 0) {
    return (
      <span className="h-tag soon">
        <Clock3 size={12} strokeWidth={2.5} aria-hidden="true" />
        {ticket.due_soon} due soon
      </span>
    )
  }
  return null
}

/** How many owners hold the items: a count, not a list of names. The names
 * stay one hover away. */
function Owners({ ticket }) {
  const total = ticket.owners.length + (ticket.owners_more || 0)
  if (total === 0) return null
  return (
    <span className="h-owners" title={ticket.owners.join('، ')}>
      <Users size={13} aria-hidden="true" />
      {total}
    </span>
  )
}

function QueueRow({ ticket, isNext }) {
  const age = ageText(ticket)
  const label = [
    ticket.short_label,
    isNext ? 'up next' : null,
    dotsLabel({ onTime: ticket.on_time, dueSoon: ticket.due_soon, late: ticket.late }),
    age ? age.toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Link
      to={ticket.url}
      className={`h-q ${isNext ? 'next' : ''}`.trim()}
      aria-label={label}
      data-queue={ticket.queue_key}
    >
      {/* The name and the count own the first line, so the name is never
          squeezed into an ellipsis; tags go on the line under the dots. */}
      <span className="h-qt" aria-hidden="true">
        <span className="h-qn">
          <span>{ticket.short_label}</span>
        </span>
        <span className="h-qc">{ticket.count}</span>
      </span>
      <ItemDots onTime={ticket.on_time} dueSoon={ticket.due_soon} late={ticket.late} />
      <span className="h-qm" aria-hidden="true">
        {isNext && <span className="h-next-badge">Up next</span>}
        <StatusTag ticket={ticket} />
        {age && <span>{age}</span>}
        <Owners ticket={ticket} />
      </span>
    </Link>
  )
}

/** The running month's drive-test plan: one dot per planned site, filled
 * as delivered (a meter beyond PLAN_DOTS_MAX sites). */
function PlanRow({ plan }) {
  const { pip, delivered, month_name: month, days_left: daysLeft } = plan
  const left = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
  if (!pip) {
    return (
      <Link to="/monthly-plan" className="h-q" aria-label={`${month} plan: no approved plan yet, ${delivered} sites delivered, ${left}`}>
        <span className="h-qt" aria-hidden="true">
          <span className="h-qn"><span>{month} plan</span></span>
        </span>
        <span className="h-qm" aria-hidden="true">No approved plan yet · {delivered} delivered · {left}</span>
      </Link>
    )
  }
  const pct = Math.round((delivered / pip) * 100)
  const filled = Math.min(delivered, pip)
  return (
    <Link
      to="/monthly-plan"
      className="h-q"
      aria-label={`${month} plan: ${delivered} of ${pip} sites delivered, ${pct} percent, ${left}`}
    >
      <span className="h-qt" aria-hidden="true">
        <span className="h-qn"><span>{month} plan</span></span>
        <span className="h-qc">{pct}<small>%</small></span>
      </span>
      {pip <= PLAN_DOTS_MAX ? (
        <span className="h-plan-dots" aria-hidden="true" data-testid="plan-dots">
          {Array.from({ length: pip }, (_, i) => (
            <i key={i} className={i < filled ? 'done' : undefined} />
          ))}
        </span>
      ) : (
        <span className="h-plan-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      )}
      <span className="h-qm" aria-hidden="true">{delivered} of {pip} sites delivered · {left}</span>
    </Link>
  )
}

export default function WorkCard({ group, upNext, plan }) {
  const look = CARD_LOOK[group.key] || CARD_LOOK.drive_test
  const Icon = look.icon
  const tickets = group.tickets
  const top = tickets[0]
  const nextTicket = tickets.find((t) => t.queue_key === upNext)
  const total = tickets.reduce((n, t) => n + t.count, 0)
  const allOnTime = tickets.length > 0 && tickets.every((t) => t.late === 0 && t.due_soon === 0)
  const headingId = `home-card-${group.key}`

  return (
    <motion.article className="h-card h-wc" aria-labelledby={headingId} variants={fadeUp}>
      <div className="h-ch">
        <span className="h-icon lg" data-tint={look.tint} aria-hidden="true">
          <Icon size={19} strokeWidth={2} />
        </span>
        <h3 className="h-ct" id={headingId}>{group.label}</h3>
        {top && (
          <Link to={top.url} className="h-go" aria-label={`Open ${top.label}`}>
            <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="h-rows">
        {tickets.map((t) => (
          <QueueRow key={t.queue_key} ticket={t} isNext={t.queue_key === upNext} />
        ))}
        {allOnTime && (
          <span className="h-allok">
            <Check size={15} strokeWidth={2.4} aria-hidden="true" />
            All {total} on time
          </span>
        )}
        {tickets.length === 0 && !plan && (
          <span className="h-card-empty">
            <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
            Nothing waiting on you
          </span>
        )}
        {plan && <PlanRow plan={plan} />}
      </div>
      {top && (
        <div className="h-cf">
          {/* The page's one primary action lives in the card that holds the
              Up-next queue; every other card gets a quiet button. */}
          {nextTicket ? (
            <Link to={nextTicket.url} className="h-pill primary" data-primary="true">
              <span>Start with {nextTicket.short_label}</span>
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          ) : (
            <Link to={top.url} className="h-pill outline">
              <span>{top.label}</span>
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </motion.article>
  )
}
