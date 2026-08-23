// The vocabulary the workspace renders, in one place.
//
// The names come from the API (see schemas.AuthorityStatus); the labels are
// what a person reads. They differ in two places on purpose: "Pending" is
// shown as "In review", because to the contractor who filed it the letter is
// not pending, it is with someone else; and "NotFiled" becomes "Not filed",
// which is a sentence rather than an enum.

export const REVIEW_ROLES = ['PM', 'Coordinator']

export const AUTHORITY_LABEL = {
  Approved: 'Approved',
  Rejected: 'Rejected',
  Returned: 'Returned',
  Pending: 'In review',
  NotFiled: 'Not filed',
}

export const AUTHORITY_PILL = {
  Approved: 'pill-green',
  Rejected: 'pill-red',
  Returned: 'pill-red',
  Pending: 'pill-amber',
  NotFiled: 'pill-dim',
}

// The left border on an authority card: where it stands, before the pill is
// read.
export const AUTHORITY_TONE = {
  Approved: 'is-approved',
  Rejected: 'is-blocked',
  Returned: 'is-blocked',
  Pending: 'is-waiting',
  NotFiled: 'is-idle',
}

export const ROLLUP_PILL = { Closed: 'pill-green', Partial: 'pill-amber', Open: 'pill-dim' }

export const AUTHORITY_WHERE = { ICT: 'Province office', CRA: 'Region office' }

// What each queue group is called, per bucket key. The server decides which
// bucket a village is in; these are only its names.
export const GROUP_LABEL = {
  needs_attention: 'Needs attention',
  ready: 'Ready to file',
  awaiting_review: 'Awaiting review',
  closed: 'Closed',
  recently_validated: 'Recently validated',
}

/**
 * The buckets this user works in, in the order they should be offered.
 *
 * Contractors and coordinators are doing different halves of the same job, so
 * the panes are identical and only the queue and the form differ. A reviewer's
 * first bucket is what is waiting on them; a submitter's is what came back.
 */
export function bucketsFor(roleName) {
  if (REVIEW_ROLES.includes(roleName)) {
    return [
      { key: 'awaiting_review', label: 'Awaiting my review' },
      { key: 'ready', label: 'Ready to file' },
      { key: 'recently_validated', label: 'Recently validated' },
    ]
  }
  return [
    { key: 'needs_attention', label: 'Needs attention' },
    { key: 'ready', label: 'Ready to file' },
    { key: 'awaiting_review', label: 'Awaiting review' },
  ]
}

/** A one-line reason a village is in the queue, for the second line of a row. */
export function queueReason(row) {
  const parts = []
  for (const authority of ['ICT', 'CRA']) {
    const status = authority === 'ICT' ? row.ict_status : row.cra_status
    if (status === 'Returned') parts.push(`${authority} returned`)
    else if (status === 'Rejected') parts.push(`${authority} rejected`)
    else if (status === 'Pending') parts.push(`${authority} in review`)
    else if (status === 'NotFiled') parts.push(`${authority} not filed`)
  }
  if (parts.length === 0) return 'Approved by both authorities'
  if (row.waiting_days != null && row.waiting_days > 0) {
    parts.push(`${row.waiting_days}d`)
  }
  return parts.join(' · ')
}

/** The pill a queue row carries: the more urgent of the two authorities. */
export function rowStatus(row) {
  for (const status of ['Returned', 'Rejected', 'Pending', 'NotFiled']) {
    if (row.ict_status === status || row.cra_status === status) return status
  }
  return 'Approved'
}

export const errorText = (err, fallback) => {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  return fallback
}
