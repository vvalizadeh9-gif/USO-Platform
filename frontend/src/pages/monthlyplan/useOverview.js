import { useEffect, useState } from 'react'
import { peek, read } from './readCache'

/**
 * GET /pip/overview with `params` -- `{ period: 'month' }` for the running
 * month, `{ period: 'month', year, month }` for another, or
 * `{ period: 'year', year, month, streams }` for the History page (which reads
 * each stream's `months[]`; `streams` limits the work to the ones it shows).
 *
 * Reads only while `enabled`, and again each time it becomes enabled, so a
 * decision taken on another page is reflected when the user comes back. A
 * response for params the page has already left is dropped. Params read
 * before draw at once from the last answer while the new one comes.
 *
 * Returns `{ state, data, reload }`: `state` is `loading`, `ready`, `failed`,
 * or `denied` (a 403: the role does not read the overview).
 */
export default function useOverview({ params, enabled }) {
  const key = JSON.stringify(params)
  const [result, setResult] = useState({ key: '', state: 'loading', data: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    read('/pip/overview', JSON.parse(key))
      .then((data) => live && setResult({ key, state: 'ready', data }))
      .catch((err) => {
        if (live) setResult({ key, state: err.response?.status === 403 ? 'denied' : 'failed', data: null })
      })
    return () => {
      live = false
    }
  }, [enabled, key, tick])

  // A reload keeps the figures on screen until the new ones arrive.
  let current = result.key === key ? result : null
  if (!current) {
    const cached = peek('/pip/overview', JSON.parse(key))
    current = cached !== undefined ? { key, state: 'ready', data: cached } : { key, state: 'loading', data: null }
  }
  return { ...current, reload: () => setTick((t) => t + 1) }
}
