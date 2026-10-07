import { useEffect, useState } from 'react'

// The board's one entrance, finished within about a second, and nothing
// after it: the rail line draws in, the step markers pop in one after
// another, and the cards rise into place. Numbers are final on first paint.
// The keyframes are CSS (.ac-animate in app.css); this file holds the timing
// a card's delay is built from. Under prefers-reduced-motion nothing moves.
export const CARD_BASE_MS = 200
export const CARD_COLUMN_MS = 50
export const CARD_ROW_MS = 40
// Cards far down a long column start no later than this row's would, so the
// entrance still ends within about a second.
const MAX_STAGGERED_ROW = 8
// How long after the board arrives the entrance classes come off, so a
// refresh never plays it again.
export const ENTRANCE_MS = 1600

export function cardDelay(column, row) {
  return CARD_BASE_MS + column * CARD_COLUMN_MS + Math.min(row, MAX_STAGGERED_ROW) * CARD_ROW_MS
}

const REDUCED = '(prefers-reduced-motion: reduce)'

/** Whether the reader asked for less motion; follows the setting live. */
export function usePrefersReducedMotion() {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED) : null
  const [reduced, setReduced] = useState(() => Boolean(query?.matches))
  useEffect(() => {
    if (!query) return undefined
    const onChange = (e) => setReduced(e.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [query])
  return reduced
}
