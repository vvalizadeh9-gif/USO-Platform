// Drill-through: turning a figure on the dashboard into the list of sites
// behind it.
//
// This is the thing the old dashboard could not do. It showed 194 problematic
// sites, 64 of them Temp Power, and offered no way to reach any of them —
// every reader who spotted something had to go and re-find it by hand in a
// different screen.
//
// The figures used to link into the work queue, and that was the wrong
// destination: the queue's stage filter and this dashboard's buckets are not
// the same definition. A site flagged Problematic by a CPM import keeps
// whatever stage its own workflow gives it, so it was counted here and absent
// from the queue the number linked to; and the queue has no on-air filter, so
// an ongoing link landed on a list holding sites the dashboard never counted.
// Every figure now goes to `/drive-test/sites`, which counts through the
// dashboard's own predicates — see `services/dt_site_list.py`, which has the
// measured size of both gaps.
//
// Building the URLs in one module rather than inline keeps the query-parameter
// names in step with what the endpoint actually accepts. A link with a
// misspelled parameter used to land on an unfiltered list, which is worse than
// no link at all because it looks like it worked; the endpoint now answers 422
// instead, and this file is what keeps that from ever being what a reader
// sees.

/** A link into the work queue, filtered by any combination we support.
 *
 * Still used where the destination really is the queue — the stage pipeline
 * links to the sites *and* to the tab a person acts on them in.
 */
export function queueLink({ stage, provinceId, contractorId } = {}) {
  const params = new URLSearchParams()
  if (stage) params.set('stage', stage)
  if (provinceId != null) params.set('province_id', String(provinceId))
  if (contractorId != null) params.set('contractor_id', String(contractorId))
  const query = params.toString()
  return `/work-items${query ? `?${query}` : ''}`
}

/** The sites behind one figure on the Drive Test dashboard.
 *
 * The parameter names live here and nowhere else, spelled as
 * `GET /drive-test/sites` reads them. `contractorId` accepts the string
 * `'none'` for the unattributed row, which is what the endpoint calls the
 * sites no company can be tied to.
 */
export function siteListLink({
  bucket = 'onair',
  category,
  ageBand,
  stage,
  contractorId,
  provinceId,
  year,
  month,
  overdue,
  ownerRoleId,
} = {}) {
  const params = new URLSearchParams()
  params.set('bucket', bucket)
  if (category) params.set('category', category)
  if (ageBand) params.set('age_band', ageBand)
  if (stage) params.set('stage', stage)
  if (contractorId != null) params.set('contractor_id', String(contractorId))
  if (provinceId != null) params.set('province_id', String(provinceId))
  if (year != null) params.set('year', String(year))
  if (month != null) params.set('month', String(month))
  if (overdue) params.set('overdue', 'true')
  if (ownerRoleId != null) params.set('owner_role_id', String(ownerRoleId))
  return `/drive-test/sites?${params.toString()}`
}

/** The sites behind a problematic figure. */
export const problematicLink = (extra) => siteListLink({ ...extra, bucket: 'problematic' })

/** The sites behind a completed figure. */
export const doneLink = (extra) => siteListLink({ ...extra, bucket: 'done' })

/** The sites behind an ongoing figure. */
export const ongoingLink = (extra) => siteListLink({ ...extra, bucket: 'ongoing' })

/** The sites behind the Remaining bracket: ongoing plus problematic. */
export const remainingLink = (extra) => siteListLink({ ...extra, bucket: 'remaining' })

/** The sites behind the on-air total. */
export const onairLink = (extra) => siteListLink({ ...extra, bucket: 'onair' })

/** The drive tests delivered in one Shamsi month. */
export const deliveredLink = ({ year, month, contractorId, provinceId } = {}) =>
  siteListLink({ bucket: 'delivered', year, month, contractorId, provinceId })
