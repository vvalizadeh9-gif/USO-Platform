import { useEffect, useState } from 'react'
import api from '../../api/client'

/**
 * GET /pip/overview with `params` -- `{ period: 'month' }` for the running
 * month, `{ period: 'month', year, month }` for another, or
 * `{ period: 'year', year, month }` for the History table (which reads each
 * stream's `months[]`).
 *
 * Reads only while `enabled`, and again each time it becomes enabled, so a
 * decision taken on another tab is reflected when the user comes back. A
 * response for params the page has already left is dropped.
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
    api
      .get('/pip/overview', { params: JSON.parse(key) })
      .then((r) => live && setResult({ key, state: 'ready', data: r.data }))
      .catch((err) => {
        if (live) setResult({ key, state: err.response?.status === 403 ? 'denied' : 'failed', data: null })
      })
    return () => {
      live = false
    }
  }, [enabled, key, tick])

  // A reload keeps the figures on screen until the new ones arrive.
  const current = result.key === key ? result : { key, state: 'loading', data: null }
  return { ...current, reload: () => setTick((t) => t + 1) }
}
