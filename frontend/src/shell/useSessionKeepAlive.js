import { useEffect } from 'react'
import api from '../api/client'
import { KEEP_ALIVE_MS } from '../lib/session'

const ACTIVITY = ['pointerdown', 'keydown']

/**
 * Typing a long form or reading a long page makes no request, so the server
 * would see 30 idle minutes and end the session under the person's hands.
 * This turns their activity into an ordinary request, at most once every five
 * minutes, which slides the idle deadline like any other.
 */
export function useSessionKeepAlive(enabled) {
  useEffect(() => {
    if (!enabled) return undefined
    let last = Date.now()
    const onActivity = () => {
      const now = Date.now()
      if (now - last < KEEP_ALIVE_MS) return
      last = now
      api.get('/auth/me').catch(() => {})
    }
    for (const type of ACTIVITY) window.addEventListener(type, onActivity, { passive: true, capture: true })
    return () => {
      for (const type of ACTIVITY) window.removeEventListener(type, onActivity, { capture: true })
    }
  }, [enabled])
}
