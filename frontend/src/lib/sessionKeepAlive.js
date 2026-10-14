// Keeps a session alive for as long as a person is actually using it.
//
// The server ends a session after 30 minutes of nobody using it (and after 8
// hours whatever happens). "Using it" has to mean a person, not the page: the
// page polls in the background, and if that counted, a screen left open on an
// empty desk would never time out. So the clock is restarted only by what a
// person does -- a click, a key, a scroll, a touch -- and at most once every
// REFRESH_EVERY_MS, so a busy session costs one small request every five
// minutes rather than one per click.
//
// The cost of throttling is that the window can be up to five minutes shorter
// than the server's thirty: someone who stops right after a renewal has a full
// half hour; someone who stops right before the next one, twenty-five minutes.

/** The fewest milliseconds between two renewals. */
export const REFRESH_EVERY_MS = 5 * 60 * 1000

/** What counts as a person being there. Capturing, so a handler that stops
 *  propagation cannot hide a click from this. */
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

/**
 * Renew the session on activity, throttled.
 *
 * The first activity after the page opens renews at once -- a reload after a
 * long idle may be on a session with a minute left, and it should not have to
 * wait out a throttle to be saved.
 *
 * @param {object} options
 * @param {() => unknown} options.refresh   Asks the server to renew.
 * @param {() => number} [options.now]      The clock, for tests.
 * @param {EventTarget} [options.target]    Where activity is heard.
 * @param {number} [options.every]          Minimum gap between renewals.
 * @returns {() => void} Stops listening.
 */
export function startKeepAlive({ refresh, now = Date.now, target = window, every = REFRESH_EVERY_MS }) {
  let lastRefresh = -Infinity

  const onActivity = () => {
    const t = now()
    if (t - lastRefresh < every) return
    lastRefresh = t
    refresh()
  }

  for (const name of ACTIVITY_EVENTS) {
    target.addEventListener(name, onActivity, { passive: true, capture: true })
  }
  return () => {
    for (const name of ACTIVITY_EVENTS) {
      target.removeEventListener(name, onActivity, { capture: true })
    }
  }
}
