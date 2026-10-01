import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ticketDate } from './format'
import { DROP_SECONDS, EASE, useCountUp } from './motion'

/**
 * One queue as a tear-off ticket: the action, its count in the stage's ink,
 * and a stub with the oldest item's date. The whole ticket is a link to the
 * queue's own screen. Every ticket is the same size (172px).
 *
 * The entrance is on a wrapper so the link's own hover lift (CSS) never
 * fights the animation for the transform.
 */
export default function Ticket({ ticket, delay, animate }) {
  const count = useCountUp(ticket.count, { animate, delayMs: delay * 1000 })
  const { word, day } = ticketDate(ticket)
  const overdue = ticket.overdue > 0
  const label = [
    `${ticket.label}: ${ticket.count}`,
    overdue && `${ticket.overdue} overdue`,
    day && `${word} ${day}`,
  ].filter(Boolean).join(', ')

  return (
    <motion.div
      className="ac-ticket-slot"
      initial={animate ? { opacity: 0, y: -40 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DROP_SECONDS, ease: EASE, delay }}
    >
      <Link to={ticket.url} className="ac-ticket" aria-label={label} data-testid="ac-ticket">
        <div className="ac-ticket-top">
          <span className="ac-ticket-label" title={ticket.label}>
            {/* Room for the pill beside the first line only; the second line
                runs the full width. */}
            {overdue && <span className="ac-pill-room" aria-hidden="true" />}
            {ticket.label}
          </span>
          <span className="ac-ticket-count" aria-hidden="true">{count}</span>
          {overdue && (
            <motion.span
              className="ac-overdue"
              aria-hidden="true"
              initial={animate ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: delay + DROP_SECONDS }}
            >
              <span className="ac-overdue-dot" />
              {ticket.overdue} overdue
            </motion.span>
          )}
        </div>
        <div className="ac-ticket-stub" aria-hidden="true">
          <span className="ac-ticket-date">
            {word} <span className="ac-date-fa" lang="fa">{day ?? '—'}</span>
          </span>
          <ArrowRight size={18} strokeWidth={2} />
        </div>
      </Link>
    </motion.div>
  )
}
