import { shamsiDayLabel } from '../../lib/shamsi'

/** A ticket's date: "since ۱۴۰۵/۰۷/۰۱", or "due ۱۴۰۵/۰۷/۰۳" for a deadline queue. */
export function ticketDate(ticket) {
  const due = ticket.date_kind === 'due'
  const day = shamsiDayLabel(due ? ticket.earliest_due_at : ticket.oldest_started_at)
  return { word: due ? 'due' : 'since', day }
}
