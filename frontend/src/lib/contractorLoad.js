// How much open work each contractor already holds, for the assignment
// dock's tiles. Read from the in-progress queues, keyed by contractor id so
// the tiles can join it to /reference/contractors.
import { HC_LATE_AFTER_DAYS } from './waiting'

/** Health checks: open = sites still pending; late = the pending sites of
 * assignments outstanding past the late line. */
export function hcLoadByContractor(rows) {
  const out = new Map()
  for (const r of rows ?? []) {
    if (r.contractor_id == null) continue
    const load = out.get(r.contractor_id) ?? { open: 0, late: 0 }
    load.open += r.sites_pending
    if (r.days_outstanding > HC_LATE_AFTER_DAYS) load.late += r.sites_pending
    out.set(r.contractor_id, load)
  }
  return out
}

/** Drive tests: one open item per site the contractor still owes. */
export function dtLoadByContractor(rows) {
  const out = new Map()
  for (const r of rows ?? []) {
    if (r.contractor_id == null) continue
    const load = out.get(r.contractor_id) ?? { open: 0, late: 0 }
    load.open += 1
    out.set(r.contractor_id, load)
  }
  return out
}
