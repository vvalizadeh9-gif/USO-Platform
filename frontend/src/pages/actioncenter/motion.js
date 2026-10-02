import { useEffect, useState } from 'react'

// The board's one entrance, and nothing after it: tickets drop in from 40px
// above, staggered by column then by place in the column; counts run up from
// zero; overdue pills fade in once their ticket has landed. Nothing loops.
export const EASE = [0.2, 0.8, 0.2, 1]
export const DROP_SECONDS = 0.7
export const COLUMN_STAGGER = 0.14
export const TICKET_STAGGER = 0.16
export const COUNT_MS = 1300

export function ticketDelay(column, index) {
  return column * COLUMN_STAGGER + index * TICKET_STAGGER
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

const easeOutCubic = (t) => 1 - (1 - t) ** 3

/**
 * `target`, counted up from 0 over COUNT_MS once, starting after `delayMs`.
 * With `animate` false it is `target` from the first render.
 */
export function useCountUp(target, { animate = true, delayMs = 0 } = {}) {
  const [value, setValue] = useState(animate ? 0 : target)
  useEffect(() => {
    if (!animate) {
      setValue(target)
      return undefined
    }
    let frame
    let start
    const tick = (now) => {
      if (start === undefined) start = now + delayMs
      const t = Math.min(Math.max((now - start) / COUNT_MS, 0), 1)
      setValue(Math.round(easeOutCubic(t) * target))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, animate, delayMs])
  return value
}
