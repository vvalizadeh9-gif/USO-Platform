import { STAGES } from './stages'
import Ticket from './Ticket'
import { ticketDelay, useCountUp } from './motion'

/**
 * One lifecycle stage: a tinted header with its icon chip, name and total,
 * then its tickets. A column with more tickets than fit scrolls inside
 * itself; the page never does.
 */
export default function StageColumn({ stage, column, animate }) {
  const meta = STAGES[stage.key] || { label: stage.label }
  const Icon = meta.icon
  const total = useCountUp(stage.total, { animate })
  const headingId = `ac-stage-${stage.key}`
  return (
    <section className="ac-col" data-stage={stage.key} aria-labelledby={headingId} aria-description={stage.label}>
      <header className="ac-col-head">
        <span className="ac-col-chip" aria-hidden="true">
          {Icon && <Icon size={18} strokeWidth={2} />}
        </span>
        <h2 className="ac-col-name" id={headingId} title={stage.label}>{meta.label}</h2>
        <span className="ac-col-total" aria-label={`${stage.total} pending`}>{total}</span>
      </header>
      <div className="ac-col-scroll">
        {stage.tickets.map((ticket, i) => (
          <Ticket
            key={ticket.queue_key}
            ticket={ticket}
            delay={animate ? ticketDelay(column, i) : 0}
            animate={animate}
          />
        ))}
      </div>
    </section>
  )
}

/** The loading state: the board's final shape, without numbers. */
export function StageColumnPlaceholder({ stageKey }) {
  const meta = STAGES[stageKey]
  const Icon = meta.icon
  return (
    <section className="ac-col" data-stage={stageKey} aria-hidden="true">
      <header className="ac-col-head">
        <span className="ac-col-chip"><Icon size={18} strokeWidth={2} /></span>
        <span className="ac-col-name">{meta.label}</span>
        <span className="ac-col-total">–</span>
      </header>
      <div className="ac-col-scroll">
        <div className="ac-ticket ac-ticket-placeholder" />
        <div className="ac-ticket ac-ticket-placeholder" />
      </div>
    </section>
  )
}
