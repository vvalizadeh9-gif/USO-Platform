// Small pure helpers the sign-in and change-password screens share (UEP-26).

export const MIN_PASSWORD_LENGTH = 12

export const CHANGE_PASSWORD_MESSAGES = Object.freeze({
  noCurrent: 'Enter your current password.',
  noCurrentForced: 'Enter the password you were given.',
  mismatch: 'The two passwords do not match.',
  failed: 'Could not change the password. Please try again.',
})

/** "name.surname" -> "NS"; "sara" -> "S". */
export function usernameInitials(username) {
  const parts = String(username).split(/[.\s_-]+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase()
}

/**
 * The help panel's contact rows that have a value, in display order.
 * @param {{ name?: string|null, hours?: string|null, email?: string|null, phone?: string|null }} support
 * @returns {{ icon: 'user'|'email'|'phone', title: string, detail: string }[]}
 */
export function contactRows(support) {
  const rows = [
    { icon: 'user', title: support?.name, detail: support?.hours || '' },
    { icon: 'email', title: support?.email, detail: 'Include your username' },
    { icon: 'phone', title: support?.phone, detail: 'Internal phone' },
  ]
  return rows.filter((row) => row.title && String(row.title).trim())
}

/**
 * Change password: the one problem to show on submit, or null. What is missing
 * first, then the length, then the match.
 * @param {{ current: string, next: string, confirm: string, forced: boolean }} fields
 */
export function passwordProblem({ current, next, confirm, forced }) {
  if (!current) return forced ? CHANGE_PASSWORD_MESSAGES.noCurrentForced : CHANGE_PASSWORD_MESSAGES.noCurrent
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `That is ${next.length} character${next.length === 1 ? '' : 's'}; ${MIN_PASSWORD_LENGTH} is the minimum.`
  }
  if (next !== confirm) return CHANGE_PASSWORD_MESSAGES.mismatch
  return null
}

/** Restart the one-shot shake on an element (CSS: .is-shaking). */
export function shake(element) {
  if (!element) return
  element.classList.remove('is-shaking')
  // Reading layout restarts the animation when the class is added back.
  void element.offsetWidth
  element.classList.add('is-shaking')
}
