// "Remember my username" on the sign-in screen.
//
// Only the username, never anything that signs anyone in: the password is the
// browser's or the password manager's to remember. Off unless the person ticks
// the box, because contractors sometimes share a laptop, and a pre-filled name
// tells the next person who used it last.
//
// Kept apart from the session keys on purpose: signing out clears the session
// and leaves this, which is the point of it.
//
// localStorage can throw rather than return null (a browser set to block site
// data), so every access is guarded and failure means "nothing remembered".
const KEY = 'uep_remembered_username'

/** @returns {string} the remembered username, or '' */
export function readRememberedUsername() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

/** @param {string} username */
export function rememberUsername(username) {
  try {
    localStorage.setItem(KEY, username)
  } catch {
    // Storage unavailable; the next visit simply starts empty.
  }
}

export function forgetUsername() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
