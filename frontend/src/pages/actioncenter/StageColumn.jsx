import { CircleCheck } from 'lucide-react'
import { cardDelay } from './motion'
import { stepHeadingId } from './stages'
import TaskCard, { TaskCardSkeleton } from './TaskCard'

/**
 * One step's cards, under its heading in the step rail. A step with nothing
 * to show says so in one line; the column never scrolls inside itself.
 */
export default function StageColumn({ step, column, queues, loading, emptyText, animate }) {
  return (
    <section className="ac-col" data-stage={step.key} aria-labelledby={stepHeadingId(step.key)}>
      {loading ? (
        <>
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </>
      ) : queues.length === 0 ? (
        <p className="ac-col-empty">
          <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
          {emptyText}
        </p>
      ) : (
        queues.map((queue, row) => (
          <TaskCard
            key={queue.key}
            queue={queue}
            stageName={step.name}
            column={column}
            row={row}
            delayMs={animate ? cardDelay(column, row) : null}
          />
        ))
      )}
    </section>
  )
}
