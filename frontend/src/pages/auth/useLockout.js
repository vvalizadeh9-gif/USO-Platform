// The sign-in lockout countdown (UEP-26).
//
// The server decides the lockout and says how long it lasts in Retry-After;
// this only counts it down, once a second, from a fixed deadline so a slow tab
// does not drift. At zero the form works again; the server is the control.
import { useCallback, useEffect, useState } from 'react'

const TICK_MS = 1000

/**
 * @returns {{ locked: boolean, remaining: number, total: number, start: (seconds: number) => void }}
 */
export function useLockout() {
  const [lock, setLock] = useState(/** @type {{ total: number, until: number } | null} */ (null))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!lock) return undefined
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= lock.until) setLock(null)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [lock])

  const start = useCallback((seconds) => {
    const t = Date.now()
    setNow(t)
    setLock({ total: seconds, until: t + seconds * 1000 })
  }, [])

  const remaining = lock ? Math.max(0, Math.ceil((lock.until - now) / 1000)) : 0
  return { locked: remaining > 0, remaining, total: lock?.total ?? 0, start }
}
