import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ageText, cardLabel } from './format'

/**
 * One queue: how many wait, how many are late, the action, and how old the
 * oldest is. The whole card is one link to the queue's own screen; it holds
 * nothing else to click. The visible parts are hidden from assistive
 * technology, which reads the card's label instead.
 */
export default function TaskCard({ queue, stageName, column, row, delayMs }) {
  const late = queue.overdue > 0
  const age = ageText(queue)
  return (
    <Link
      to={queue.url}
      className="ac-card"
      data-col={column}
      data-row={row}
      data-testid="ac-card"
      aria-label={cardLabel(queue, stageName)}
      style={delayMs == null ? undefined : { '--ac-delay': `${delayMs}ms` }}
    >
      <span className="ac-card-top" aria-hidden="true">
        <span className={late ? 'ac-card-count is-late' : 'ac-card-count'}>{queue.count}</span>
        {late && (
          <span className="ac-card-overdue">
            <span className="ac-card-dot" />
            {queue.overdue} overdue
          </span>
        )}
      </span>
      <span className="ac-card-name" aria-hidden="true">{queue.label}</span>
      <span className="ac-card-meta" aria-hidden="true">
        <span>{age}</span>
        <ArrowUpRight size={16} strokeWidth={2} />
      </span>
    </Link>
  )
}

/** A card's place while the board loads. */
export function TaskCardSkeleton() {
  return (
    <div className="ac-card-skeleton" aria-hidden="true">
      <span className="ac-skel ac-skel-count" />
      <span className="ac-skel ac-skel-name" />
      <span className="ac-skel ac-skel-meta" />
    </div>
  )
}
