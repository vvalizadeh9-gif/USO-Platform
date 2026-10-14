// The session is 30 minutes idle and 8 hours at most (see
// backend/app/core/session_renewal.py). Every request the person causes slides
// the idle deadline; a request nobody asked for must say so, or an open tab
// would keep its session alive forever.

/** Sent on requests the page makes on its own (the shell's minute refresh). */
export const BACKGROUND_HEADERS = Object.freeze({ 'X-UEP-Background': '1' })

/** How often, at most, typing or clicking tells the server someone is there. */
export const KEEP_ALIVE_MS = 5 * 60 * 1000
