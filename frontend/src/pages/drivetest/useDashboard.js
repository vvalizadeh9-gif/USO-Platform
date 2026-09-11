import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'

/** One endpoint's lifecycle, tracked separately from its neighbours.
 *
 * The three sections of this dashboard come from three endpoints that fail
 * independently, and the old page handled that by making a failed section
 * disappear — `.catch(() => setPlan(null))` and a component that returned
 * null. A reader then saw a shorter page with no way to know a section
 * existed, let alone that it had failed. Each section now carries its own
 * status so it can say "couldn't load, retry" in the space it would occupy.
 */
const IDLE = { data: null, error: false, loading: true }

/**
 * Fetch the dashboard, refresh it on demand, and keep the province filter in
 * the URL.
 *
 * The filter lives in the query string, not in component state, so a narrowed
 * dashboard is a link someone can send — which is the whole reason a person
 * narrows one during a meeting. The section tabs stay local (see
 * `BreakdownCard`): a tab is a way of looking at one card, a province filter
 * changes every figure on the page, and only the second is worth a URL.
 */
export function useDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const provinceParam = searchParams.get('province')
  const provinceId = provinceParam && /^\d+$/.test(provinceParam) ? Number(provinceParam) : null

  const [overview, setOverview] = useState(IDLE)
  const [plan, setPlan] = useState(IDLE)
  const [trend, setTrend] = useState(IDLE)
  const [refreshing, setRefreshing] = useState(false)

  // Bumped by `refresh()` to re-run the effect without making the province a
  // dependency of a manual action.
  const [nonce, setNonce] = useState(0)

  // Guards against a slow response from a previous province overwriting a
  // faster one from the current filter — the classic out-of-order fetch,
  // which on this page would show one province's KPIs beside another's table.
  const latest = useRef(0)

  useEffect(() => {
    const ticket = ++latest.current
    const params = provinceId == null ? {} : { province_id: provinceId }
    const fresh = (setter) => (result) => {
      if (latest.current === ticket) setter(result)
    }

    setOverview((s) => ({ ...s, loading: true }))
    setPlan((s) => ({ ...s, loading: true }))
    setTrend((s) => ({ ...s, loading: true }))

    const done = []
    const track = (promise) => {
      done.push(promise)
      return promise
    }

    track(
      api
        .get('/drive-test/overview', { params })
        .then((r) => fresh(setOverview)({ data: r.data, error: false, loading: false }))
        .catch(() => fresh(setOverview)({ data: null, error: true, loading: false })),
    )
    track(
      api
        .get('/drive-test/plan-delivery')
        .then((r) => fresh(setPlan)({ data: r.data, error: false, loading: false }))
        .catch(() => fresh(setPlan)({ data: null, error: true, loading: false })),
    )
    track(
      api
        .get('/drive-test/trend', { params })
        .then((r) => fresh(setTrend)({ data: r.data, error: false, loading: false }))
        .catch(() => fresh(setTrend)({ data: null, error: true, loading: false })),
    )

    Promise.all(done).then(() => {
      if (latest.current === ticket) setRefreshing(false)
    })
  }, [provinceId, nonce])

  const refresh = useCallback(() => {
    setRefreshing(true)
    setNonce((n) => n + 1)
  }, [])

  const setProvince = useCallback(
    (next) => {
      const params = new URLSearchParams(searchParams)
      if (next == null) params.delete('province')
      else params.set('province', String(next))
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return { overview, plan, trend, provinceId, setProvince, refresh, refreshing }
}
