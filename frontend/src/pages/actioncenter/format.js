// A board ticket from GET /action-center/board, turned into what a card
// shows: its count, how many are late, and how old its oldest item is (or,
// for a deadline queue, how long until it is due).

const DAY_MS = 24 * 60 * 60 * 1000

function wholeDays(from, to, round) {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) ? round(ms / DAY_MS) : null
}

/** A ticket as a card's queue: stage, label, count, overdue, url and its age. */
export function toQueue(ticket, stage, now) {
  const due = ticket.date_kind === 'due'
  return {
    key: ticket.queue_key,
    stage,
    label: ticket.label,
    count: ticket.count,
    overdue: ticket.overdue,
    url: ticket.url,
    oldest_days: due ? null : ticket.oldest_days ?? wholeDays(ticket.oldest_started_at, now, Math.floor),
    due_in_days: due ? ticket.due_in_days ?? wholeDays(now, ticket.earliest_due_at, Math.ceil) : null,
  }
}

const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`

/** "Oldest 12 days", "Due in 3 days", "Due 2 days ago" -- or null. */
export function ageText(queue) {
  const due = queue.due_in_days
  if (due != null) {
    if (due < 0) return `Due ${days(-due)} ago`
    return due === 0 ? 'Due today' : `Due in ${days(due)}`
  }
  const oldest = queue.oldest_days
  if (oldest == null) return null
  return oldest <= 0 ? 'Oldest today' : `Oldest ${days(oldest)}`
}

/** "Review HC results, Health Check: 9 pending, 2 overdue, oldest 12 days" */
export function cardLabel(queue, stageName) {
  const age = ageText(queue)
  return [
    `${queue.label}, ${stageName}: ${queue.count} pending`,
    queue.overdue > 0 && `${queue.overdue} overdue`,
    age && age[0].toLowerCase() + age.slice(1),
  ].filter(Boolean).join(', ')
}

// How long a queue has waited, for sorting: the oldest item's age, or for a
// deadline queue the nearer the deadline the older it counts.
function age(queue) {
  if (queue.oldest_days != null) return queue.oldest_days
  if (queue.due_in_days != null) return -queue.due_in_days
  return Number.NEGATIVE_INFINITY
}

/** Most overdue first, then the oldest. */
export function sortQueues(queues) {
  return [...queues].sort((a, b) => b.overdue - a.overdue || Math.sign(age(b) - age(a)) || 0)
}

export const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`
