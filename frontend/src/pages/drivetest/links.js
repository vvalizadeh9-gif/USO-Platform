// Drill-through: turning a figure on the dashboard into the list of sites
// behind it.
//
// This is the thing the old dashboard could not do. It showed 194 problematic
// sites, 64 of them Temp Power, and offered no way to reach any of them —
// every reader who spotted something had to go and re-find it by hand in a
// different screen. The work queues could already filter by stage; they now
// also filter by province and contractor, so most figures here have a real
// destination.
//
// Building the URLs in one module rather than inline keeps the query-parameter
// names in step with what `api/work_items.list_work_items` actually accepts —
// a link with a misspelled parameter silently lands on an unfiltered list,
// which is worse than no link at all because it looks like it worked.

import { STAGE_DT_DONE, STAGE_PROBLEMATIC } from './constants'

/** A link into the work queue, filtered by any combination we support. */
export function queueLink({ stage, provinceId, contractorId } = {}) {
  const params = new URLSearchParams()
  if (stage) params.set('stage', stage)
  if (provinceId != null) params.set('province_id', String(provinceId))
  if (contractorId != null) params.set('contractor_id', String(contractorId))
  const query = params.toString()
  return `/work-items${query ? `?${query}` : ''}`
}

/** The sites behind a problematic figure. */
export const problematicLink = (extra) =>
  queueLink({ stage: STAGE_PROBLEMATIC, ...extra })

/** The sites behind a completed figure. */
export const doneLink = (extra) => queueLink({ stage: STAGE_DT_DONE, ...extra })

/** The sites behind an ongoing figure.
 *
 * No stage: ongoing spans seven of them, and pinning one would land the
 * reader on a fraction of the number they clicked. The queue's own All tab
 * with the province or contractor applied is the honest destination.
 */
export const ongoingLink = (extra) => queueLink(extra)
