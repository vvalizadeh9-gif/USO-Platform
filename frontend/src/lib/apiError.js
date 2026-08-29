// One place that turns an axios error into a sentence a person can act on.
//
// FastAPI reports a policy failure as a string ("That is one of the most
// commonly used passwords") and a schema failure as a list of per-field
// objects. Rendering the second kind raw puts "[object Object]" in front of
// somebody who is trying to fix a form, which is how a helpful message becomes
// a dead end.
//
// There is a third shape: the must-change-password gate returns an object with
// a machine-readable `code`, so the interface can route rather than only
// display. Its `message` is what to show if it is displayed anyway.

export function detailMessage(err, fallback = 'Please check the fields and try again.') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0]
    if (first?.msg) {
      // The last element of `loc` is the field name; the ones before it are
      // "body", "query" and so on, which mean nothing to the reader.
      const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null
      return field ? `${field}: ${first.msg}` : first.msg
    }
  }
  if (detail?.message) return detail.message
  return fallback
}

// The code the backend sends when an account is on a temporary password and
// may do nothing but replace it. Kept beside the parser because the two are
// read together, and mirrored from app/core/deps.py.
export const PASSWORD_CHANGE_REQUIRED = 'password_change_required'

export function isPasswordChangeRequired(err) {
  return (
    err?.response?.status === 403
    && err?.response?.data?.detail?.code === PASSWORD_CHANGE_REQUIRED
  )
}
