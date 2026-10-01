// Undo by not sending yet.
//
// A send or a decision is held in the browser for HOLD_MS with a toast
// offering Undo; only when the hold runs out is it sent. Nothing decided ever
// has to be rolled back on the server, and Undo behaves the same for every
// role. A held send is never dropped: closing the tab sends it at once with
// `keepalive`, leaving the page sends it at once, and dismissing the toast
// sends it at once.
import { useCallback, useEffect, useRef, useState } from 'react'
import { sendNow } from './api'

export const HOLD_MS = 6000

let seq = 0

/**
 * `hold({ text, path, body, run, overlay, onDone, onFail })` holds one send.
 * `run()` performs it (normally an axios call); `path` + `body` are what
 * `keepalive` sends if the page goes away first. `overlay` is what the page
 * shows meanwhile (`{ villageIds, authority, status }`).
 */
export function useDeferredSend() {
  const [held, setHeld] = useState([])
  const timers = useRef(new Map())
  const entries = useRef(new Map())

  const settle = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    entries.current.delete(id)
    setHeld((list) => list.filter((e) => e.id !== id))
  }, [])

  const commit = useCallback(async (id) => {
    const entry = entries.current.get(id)
    if (!entry || entry.sending) return
    entry.sending = true
    clearTimeout(timers.current.get(id))
    setHeld((list) => list.map((e) => (e.id === id ? { ...e, sending: true } : e)))
    try {
      const result = await entry.run()
      await entry.onDone?.(result)
    } catch (err) {
      entry.onFail?.(err)
    } finally {
      settle(id)
    }
  }, [settle])

  const hold = useCallback((request) => {
    const id = ++seq
    const entry = { id, sending: false, ...request }
    entries.current.set(id, entry)
    timers.current.set(id, setTimeout(() => commit(id), HOLD_MS))
    setHeld((list) => [...list, entry])
    return id
  }, [commit])

  const undo = useCallback((id) => {
    const entry = entries.current.get(id)
    if (!entry || entry.sending) return
    entry.onUndo?.()
    settle(id)
  }, [settle])

  // The page is going away: whatever is still held is sent now.
  useEffect(() => {
    const flush = () => {
      for (const entry of entries.current.values()) {
        if (!entry.sending) sendNow(entry.path, entry.body)
      }
      entries.current.clear()
    }
    window.addEventListener('pagehide', flush)
    const pending = entries.current
    return () => {
      window.removeEventListener('pagehide', flush)
      for (const id of [...pending.keys()]) commit(id)
    }
  }, [commit])

  return { held, hold, undo, commit }
}
