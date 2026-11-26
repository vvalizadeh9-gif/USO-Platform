import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import AppTile from '../../shell/AppTile'
import { APPS } from '../../shell/appRegistry'
import { formatNumber } from '../../lib/numbers'
import { cardSections, metaText, mojriRow, rowCount, statusLabel, ticketParts, unitFor } from './homeLogic'

// Each card is its app's: tile colour and icon from the registry.
const CARD_APP = { drive_test: 'drive-test', acceptance: 'acceptance', plans: 'monthly-plan' }
const appById = (id) => APPS.find((a) => a.id === id)

/** A row's 4px strip: its own late / due / on time / no date parts. With a
 * status filter on, the other parts dim. */
function StatusStrip({ ticket, filter }) {
  const parts = ticketParts(ticket)
  return (
    <span className="hw-strip" aria-hidden="true">
      {parts.map((p) => (
        <i
          key={p.key}
          className={`${p.cls}${filter && filter !== p.key && filter !== 'waiting' ? ' is-dim' : ''}`}
          style={{ flexGrow: p.count }}
        />
      ))}
    </span>
  )
}

/** One queue. Every row looks the same: none is singled out as "next". */
function QueueRow({ ticket, filter, index, onOpen }) {
  const n = rowCount(ticket, filter)
  const unit = unitFor(n, ticket.unit)
  const late = filter === 'late' && n > 0
  const filtered = filter ? `, ${statusLabel(filter).toLowerCase()}` : ''
  return (
    <button
      type="button"
      className={`hw-qrow${filter && n === 0 ? ' is-dim' : ''}`}
      style={{ '--r': index }}
      data-queue={ticket.queue_key}
      title={metaText(ticket) || undefined}
      aria-label={`${ticket.short_label}, ${formatNumber(n)} ${unit}${filtered}, show list`}
      onClick={(e) => onOpen(ticket, e.currentTarget)}
    >
      <span className="hw-qlabel">{ticket.short_label}</span>
      <span className={`hw-qcount${late ? ' is-late' : ''}`} data-testid={`count-${ticket.queue_key}`}>
        {formatNumber(n)}
        <small>{unit}</small>
      </span>
      <Icon name="chevron--right" size={16} className="hw-chev" />
      <StatusStrip ticket={ticket} filter={filter} />
    </button>
  )
}

/** The Mojri tracker (a reminder, never counted): days since the last
 * upload, red once that is past the follow-up days. Opens its page. */
function MojriRow({ ticket, filter, index }) {
  const navigate = useNavigate()
  const row = mojriRow(ticket)
  const dim = filter && !(filter === 'late' && row.stale)
  return (
    <button
      type="button"
      className={`hw-qrow hw-mojri${dim ? ' is-dim' : ''}`}
      style={{ '--r': index }}
      data-queue={ticket.queue_key}
      aria-label={`Mojri tracker, ${row.stale ? `late, ${row.text}` : `${row.days} days since the last upload`}`}
      onClick={() => navigate(ticket.url)}
    >
      <span className="hw-qlabel">{ticket.short_label}</span>
      <span className={`hw-qcount${row.stale ? ' is-late' : ''}`}>
        {formatNumber(row.days)}
        <small>{unitFor(row.days, 'days')}</small>
      </span>
      <Icon name="chevron--right" size={16} className="hw-chev" />
      <span className="hw-qmeta">
        {row.stale ? <><span className="hw-late">Late</span>, {row.text}</> : row.text}
      </span>
    </button>
  )
}

/** Contractor PIP this month: delivered against target. Opens the PIP by
 * contractor when `onOpen` is given (PM). */
function PlanProgress({ plan, onOpen }) {
  const target = plan.pip || 0
  const pct = target ? Math.min(100, Math.round((plan.delivered / target) * 100)) : 0
  const days = `${formatNumber(plan.days_left)} ${plan.days_left === 1 ? 'day' : 'days'} left`
  const body = (
    <>
      <span className="hw-plan-head">
        <span>Contractor PIP this month</span>
        <span>{target ? `${pct}%` : 'No plan'}</span>
      </span>
      <span className="hw-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Contractor PIP this month">
        <i style={{ '--pct': `${pct}%` }} />
      </span>
      <span className="hw-plan-line">
        {formatNumber(plan.delivered)} of {target ? formatNumber(target) : '—'} sites delivered, {days}
      </span>
    </>
  )
  if (!onOpen) return <div className="hw-plan">{body}</div>
  return (
    <button
      type="button"
      className="hw-plan is-button"
      data-testid="pip"
      aria-label={`Contractor PIP this month, ${pct}%, show by contractor`}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      {body}
    </button>
  )
}

/**
 * A card per area of work (UEP-27 §4.2): the viewer's own queues, then the
 * ones others hold under "Waiting on others". No card total: a card's rows
 * count different things, and each count names its unit.
 */
export default function WorkCard({ group, plan, filter, index = 0, rowStart = 0, onOpenQueue, onOpenPip }) {
  const app = appById(CARD_APP[group.key])
  const headingId = `home-card-${group.key}`
  const { mine, theirs } = cardSections(group.tickets)
  let r = rowStart
  const row = (t) => (t.holder === 'reminder'
    ? <MojriRow key={t.queue_key} ticket={t} filter={filter} index={r++} />
    : <QueueRow key={t.queue_key} ticket={t} filter={filter} index={r++} onOpen={onOpenQueue} />)
  return (
    <article className="hw-card" aria-labelledby={headingId} data-card={group.key} style={{ '--i': index }}>
      <header className="hw-head">
        <AppTile app={app} size={28} />
        <h3 id={headingId}>{group.label}</h3>
      </header>
      <div className="hw-rows">
        {mine.map(row)}
        {theirs.length > 0 && (
          <>
            <p className="hw-sub" data-testid={`waiting-${group.key}`}>Waiting on others</p>
            {theirs.map(row)}
          </>
        )}
      </div>
      {plan && <PlanProgress plan={plan} onOpen={onOpenPip} />}
    </article>
  )
}
