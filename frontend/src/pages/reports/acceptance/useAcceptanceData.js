import { useCallback, useEffect, useState } from 'react'
import api from '../../../api/client'

/**
 * One GET, as a card's state: `{ data, error, loading, loadedAt, retry }`.
 *
 * Each card owns one of these, so one failure never blanks another card and
 * Retry refetches only its own source. A response for params the page has
 * already left is dropped. `params` is compared by value (`paramsKey`), so a
 * new object for the same scope is not a new request.
 */
export function useResource(url, params) {
  const paramsKey = JSON.stringify(params ?? {})
  const [tick, setTick] = useState(0)
  const [state, setState] = useState({ data: null, error: null, loading: true, loadedAt: null })

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, error: null, loading: true }))
    api
      .get(url, { params: JSON.parse(paramsKey) })
      .then((r) => live && setState({ data: r.data, error: null, loading: false, loadedAt: Date.now() }))
      .catch((err) => {
        if (!live) return
        const detail = err.response?.data?.detail
        setState({ data: null, error: typeof detail === 'string' ? detail : 'Could not load this.', loading: false, loadedAt: null })
      })
    return () => {
      live = false
    }
  }, [url, paramsKey, tick])

  const retry = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, retry }
}

/**
 * The page's two sources, for one scope: the overview (KPI band) and the
 * progress payload (chart and month panel, all three streams at once -- so a
 * tab switch never refetches). `refresh` reloads both.
 */
export default function useAcceptanceData(scope) {
  const overview = useResource('/acceptance/overview', scope)
  const progress = useResource('/acceptance/progress', scope)
  const { retry: retryOverview } = overview
  const { retry: retryProgress } = progress
  const refresh = useCallback(() => {
    retryOverview()
    retryProgress()
  }, [retryOverview, retryProgress])
  // "Updated N min ago" is the older of the two: the page is as fresh as its
  // stalest figure.
  const loaded = [overview.loadedAt, progress.loadedAt].filter(Boolean)
  const loadedAt = loaded.length ? Math.min(...loaded) : null
  return { overview, progress, refresh, loadedAt, refreshing: overview.loading || progress.loading }
}
