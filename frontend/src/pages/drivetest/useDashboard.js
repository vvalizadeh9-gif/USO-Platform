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

/** How many trailing months `/trend` is asked for.
 *
 * Twelve, fixed: the only card that used to let a reader change this window
 * drew a chart directly from it, and that chart is gone (see FlowChart). What
 * is left reading `/trend` is "What moved", which always wants the newest
 * captured month regardless of how far back the series goes, so there is no
 * reader-facing choice left to expose here.
 */
export const DEFAULT_TREND_MONTHS = 12

/**
 * Fetch the dashboard, refresh it on demand, and keep the province filter in
 * the URL.
 *
 * The filter lives in the query string, not in component state, so a narrowed
 * dashboard is a link someone can send — which is the whole reason a person
 * narrows one during a meeting. The section tabs stay local (see
 * `BreakdownCard`), and so does the trend window: a tab or a window is a way
 * of looking at one card, a province filter changes every figure on the page,
 * and only the second is worth a URL.
 *
 * THE TREND FETCHES ON ITS OWN. It used to ride in the same effect as the
 * other two, which was right while nothing but the province could change it.
 * The window control changes only this card, and re-reading the overview and
 * the plan to answer it would refetch the whole page — and blank every
 * section on it — to redraw one chart.
 */
export function useDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const provinceParam = searchParams.get('province')
  const provinceId = provinceParam && /^\d+$/.test(provinceParam) ? Number(provinceParam) : null

  const [overview, setOverview] = useState(IDLE)
  const [plan, setPlan] = useState(IDLE)
  const [trend, setTrend] = useState(IDLE)
  const [trendMonths, setTrendMonths] = useState(DEFAULT_TREND_MONTHS)
  const [flow, setFlow] = useState(IDLE)
  const [refreshing, setRefreshing] = useState(false)

  // Bumped by `refresh()` to re-run the effect without making the province a
  // dependency of a manual action.
  const [nonce, setNonce] = useState(0)

  // Guards against a slow response from a previous province overwriting a
  // faster one from the current filter — the classic out-of-order fetch,
  // which on this page would show one province's KPIs beside another's table.
  // One ticket per effect: they run on different dependencies, and a shared
  // counter would let a trend request invalidate an overview still in flight.
  const latest = useRef(0)
  const latestTrend = useRef(0)
  const latestFlow = useRef(0)

  useEffect(() => {
    const ticket = ++latest.current
    const params = provinceId == null ? {} : { province_id: provinceId }
    const fresh = (setter) => (result) => {
      if (latest.current === ticket) setter(result)
    }

    setOverview((s) => ({ ...s, loading: true }))
    setPlan((s) => ({ ...s, loading: true }))

    const done = [
      api
        .get('/drive-test/overview', { params })
        .then((r) => fresh(setOverview)({ data: r.data, error: false, loading: false }))
        .catch(() => fresh(setOverview)({ data: null, error: true, loading: false })),
      api
        // No province: a PIP is a contractor's commitment for a month and
        // carries none, so there is no province figure to narrow to. See the
        // note in `PlanDelivery`, which says so on the card.
        .get('/drive-test/plan-delivery')
        .then((r) => fresh(setPlan)({ data: r.data, error: false, loading: false }))
        .catch(() => fresh(setPlan)({ data: null, error: true, loading: false })),
    ]

    Promise.all(done).then(() => {
      if (latest.current === ticket) setRefreshing(false)
    })
  }, [provinceId, nonce])

  useEffect(() => {
    const ticket = ++latestTrend.current
    const params = { months: trendMonths }
    if (provinceId != null) params.province_id = provinceId

    setTrend((s) => ({ ...s, loading: true }))
    api
      .get('/drive-test/trend', { params })
      .then((r) => {
        if (latestTrend.current === ticket) {
          setTrend({ data: r.data, error: false, loading: false })
        }
      })
      .catch(() => {
        if (latestTrend.current === ticket) {
          setTrend({ data: null, error: true, loading: false })
        }
      })
  }, [provinceId, trendMonths, nonce])

  // On-air vs DT-done activity by Shamsi month, for the "Where this is
  // going" flow chart. A third independent fetch for the same reason the
  // trend has its own: this reads live work items rather than the monthly
  // snapshot table `/trend` reads, so the two have nothing in common to
  // share an effect over, and a slow one must not blank a card the other
  // has already answered.
  useEffect(() => {
    const ticket = ++latestFlow.current
    const params = provinceId == null ? {} : { province_id: provinceId }

    setFlow((s) => ({ ...s, loading: true }))
    api
      .get('/drive-test/flow', { params })
      .then((r) => {
        if (latestFlow.current === ticket) {
          setFlow({ data: r.data, error: false, loading: false })
        }
      })
      .catch(() => {
        if (latestFlow.current === ticket) {
          setFlow({ data: null, error: true, loading: false })
        }
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

  return {
    overview,
    plan,
    trend,
    trendMonths,
    setTrendMonths,
    flow,
    provinceId,
    setProvince,
    refresh,
    refreshing,
  }
}
