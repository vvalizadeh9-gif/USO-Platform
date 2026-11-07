// The session is 30 minutes idle and 8 hours at most (see
// backend/app/core/session_renewal.py). Every request the person causes slides
// the idle deadline; a request nobody asked for must say so, or an open tab
// would keep its session alive forever.

import { clearActionLog } from './actionLog'
import { forgetList } from '../pages/explorer/listModel'

/** Sent on requests the page makes on its own (the shell's minute refresh). */
export const BACKGROUND_HEADERS = Object.freeze({ 'X-UEP-Background': '1' })

/** How often, at most, typing or clicking tells the server someone is there. */
export const KEEP_ALIVE_MS = 5 * 60 * 1000

// Everything the interface keeps for whoever is signed in. Cleared on sign-in,
// sign-out and expiry, so the next person -- or the same one after a timeout --
// starts on the landing page with nothing of the last session (UEP-19).
// Kept: the remembered username (the sign-in form's own choice) and the motion
// override (a setting of this browser, not of the person).
const KEEP = new Set(['uep_remembered_username', 'uep_motion'])

function clearStore(store) {
  try {
    Object.keys(store)
      .filter((key) => /^uep[._]/.test(key) && !KEEP.has(key))
      .forEach((key) => store.removeItem(key))
  } catch {
    // Storage blocked: there is nothing kept to clear.
  }
}

/** Forget every per-user value this tab and browser hold. */
export function resetClientSession() {
  clearActionLog()
  forgetList()
  clearStore(window.sessionStorage)
  clearStore(window.localStorage)
}
