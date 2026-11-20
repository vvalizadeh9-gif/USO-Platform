// Acceptance › Filing (UEP-22): the page's wording and small decisions, kept
// out of the components so they can be tested on their own. The server
// decides every state, count and permission; this only words them.

export const AUTHORITIES = ['ICT', 'CRA']
export const TABS = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting', tone: 'waiting' },
  { key: 'rejected', label: 'Rejected', tone: 'rejected' },
  { key: 'no_comment', label: 'No comment', tone: 'danger' },
]

export const CHOICE_WAITING = 'waiting'
export const CHOICE_APPROVED = 'approved'
export const CHOICE_REJECTED = 'rejected'

/** The three choice tiles, worded for the case's state (§3.1). */
export function choiceTiles(state) {
  return [
    { key: CHOICE_WAITING, hint: 'W', label: state === 'rejected' ? 'Fixed · back to contractor' : 'Waiting · add comment', tone: 'waiting' },
    { key: CHOICE_APPROVED, hint: 'A', label: 'Approved', tone: 'approved' },
    { key: CHOICE_REJECTED, hint: 'R', label: 'Rejected', tone: 'rejected' },
  ]
}

/** Which tiles this viewer may use on a case in `state` (§4.4). */
export function allowedChoices(can, state) {
  if (!can || can.read_only) return []
  const out = []
  if (state === 'rejected' ? can.fix : can.comment) out.push(CHOICE_WAITING)
  if (can.record_letters) out.push(CHOICE_APPROVED, CHOICE_REJECTED)
  return out
}

/** The comment box's placeholder per choice. */
export function commentPlaceholder(choice, state, authority) {
  if (choice === CHOICE_APPROVED) return 'Anything to note'
  if (choice === CHOICE_REJECTED) return `Why did ${authority} reject?`
  return state === 'rejected' ? 'What was fixed?' : `Latest follow-up with ${authority}`
}

/** The basket a rejection in `category` goes to, in words. */
export function basketFor(category, contractor) {
  if (!category) return null
  if (category.basket_role === 'Contractor') return contractor || 'Contractor'
  if (category.basket_role === 'PM') return 'PM'
  return category.label
}

/** The fields a choice requires (the server checks them again). */
export function missingFields({ choice, comment, category, letterNo, letterDate, scanId }) {
  const missing = {}
  if (!String(comment || '').trim()) missing.comment = 'missing'
  if (choice === CHOICE_REJECTED && !category) missing.category = 'missing'
  if (choice !== CHOICE_WAITING) {
    if (!String(letterNo || '').trim()) missing.letter_no = 'missing'
    if (!String(letterDate || '').trim()) missing.letter_date = 'missing'
    if (!scanId) missing.scan = 'missing'
  }
  return missing
}

/** Server errors (`detail.errors`) as one message per field. */
export function fieldErrors(error) {
  const list = error?.response?.data?.detail?.errors || []
  const out = {}
  for (const e of list) {
    if (e.field && !out[e.field]) out[e.field] = e.message || e.code
  }
  return out
}

/** Every row of the inbox, in the order shown. */
export function flatRows(inbox) {
  return (inbox?.groups || []).flatMap((g) => g.rows)
}

/** The row after `villageId` (wrapping), for "Save · next village". */
export function nextVillage(rows, villageId) {
  if (!rows.length) return null
  const i = rows.findIndex((r) => r.village_id === villageId)
  if (i < 0) return rows[0].village_id
  if (rows.length === 1) return null
  return rows[(i + 1) % rows.length].village_id
}

/** J/K: the row before or after the selected one, clamped. */
export function stepVillage(rows, villageId, delta) {
  if (!rows.length) return null
  const i = rows.findIndex((r) => r.village_id === villageId)
  const next = Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i + delta)))
  return rows[next].village_id
}

/** A status box's comment line (§3.1). */
export function commentLine(comment) {
  if (!comment) return null
  if (comment.stale) {
    return {
      stale: true,
      text: comment.age_days == null ? 'No comment yet' : `Last comment ${comment.age_days} d ago · needs an update`,
    }
  }
  const who = comment.author ? ` · ${comment.author}` : ''
  return { stale: false, text: `“${comment.text}”${who}, ${comment.age_days} d ago` }
}

/** The other authority. */
export const otherAuthority = (authority) => (authority === 'ICT' ? 'CRA' : 'ICT')

/** True when a key press came from a field the person is typing in. */
export function isTyping(target) {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable
}

/** A fresh id for one save, so a retried request is applied once. */
export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
