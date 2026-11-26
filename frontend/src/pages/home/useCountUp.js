import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../../lib/motionPreference'

const DURATION_MS = 800
const START_DELAY_MS = 150
/** Small figures just appear: counting 0→3 reads as a flicker, not motion. */
const MIN_ANIMATED = 10

/**
 * A figure that counts up from 0 once, on first show (UEP-27 §4.6). Later
 * changes (a refresh) show at once. Reduced motion shows the figure at once.
 * Transform-free: only the text changes, and input is never blocked.
 */
export default function useCountUp(value) {
  const played = useRef(false)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (played.current || value < MIN_ANIMATED || reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      played.current = true
      setShown(value)
      return undefined
    }
    played.current = true
    let frame = 0
    const t0 = performance.now() + START_DELAY_MS
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / DURATION_MS))
      setShown(Math.round(value * (1 - (1 - k) ** 3)))
      if (k < 1) frame = requestAnimationFrame(step)
    }
    setShown(0)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return shown
}
