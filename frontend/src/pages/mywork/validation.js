// What a side must have before its button sends it. Checked only when the
// button is pressed, and only for that side; the errors are drawn inside the
// fields ("Missing", "Scan missing", "Reason missing"). The server checks the
// same things again and its answer maps onto the same keys (serverErrors).

const SHAMSI = /^1[34]\d\d\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/

/** True when `text` (Latin digits) reads as a Shamsi date. */
export const isShamsiDate = (text) => SHAMSI.test(String(text || '').trim())

/** The letter's own fields: number, date, scan. */
export function letterErrors(letter) {
  const errors = {}
  if (!String(letter.number || '').trim()) errors.number = 'missing'
  if (!String(letter.date || '').trim()) errors.date = 'missing'
  else if (!isShamsiDate(letter.date)) errors.date = 'invalid'
  if (!letter.scan?.scanId) errors.scan = 'missing'
  return errors
}

/** One village's rejected techs that have no reason: {tech: 'missing'}. */
export function reasonErrors(verdicts) {
  const errors = {}
  for (const [tech, verdict] of Object.entries(verdicts || {})) {
    if (verdict.result === 'rejected' && !String(verdict.reason || '').trim()) errors[tech] = 'missing'
  }
  return errors
}

/** A "+ Rejection" row in the many-villages form. */
export function rejectionErrors(rejection) {
  const errors = {}
  if (!rejection.techs.length) errors.techs = 'missing'
  if (!String(rejection.reason || '').trim()) errors.reason = 'missing'
  return errors
}

export const hasErrors = (errors) => Object.values(errors).some((e) =>
  e && (typeof e === 'string' || Object.keys(e).length > 0))

/** The server's field errors (docs/design/my-work-api.md §0) as form keys. */
export function serverErrors(detail) {
  const fields = {}
  const reasons = {}
  const other = []
  for (const error of detail?.errors || []) {
    if (error.field === 'letter_number') fields.number = 'missing'
    else if (error.field === 'letter_date') fields.date = error.code === 'invalid_date' ? 'invalid' : 'missing'
    else if (error.field === 'scan_id') fields.scan = 'missing'
    else if (error.code === 'reason_missing' && error.village_id) {
      reasons[error.village_id] = { ...(reasons[error.village_id] || {}), [error.tech]: 'missing' }
    } else other.push(error)
  }
  return { fields, reasons, other, message: detail?.message }
}
