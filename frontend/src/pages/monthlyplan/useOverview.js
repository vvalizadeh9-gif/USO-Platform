import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'

/**
 * GET /pip/overview for one period, the read behind the PIP vs Achieved tab.
 *
 * Reads only while `enabled` (the tab is on screen), and again each time it
 * becomes enabled, so a decision taken on the Plans tab is reflected when
 * the PM comes back. `reload` re-reads on demand (after a decision or a new
 * internal target).
 */
export default function useOverview({ view, period, enabled }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(() => {
    setFailed(false)
    const params = { period: view }
    if (view !== 'since_start' && period.year && period.month) {
      params.year = period.year
      params.month = period.month
    }
    api
      .get('/pip/overview', { params })
      .then((r) => setData(r.data))
      .catch(() => setFailed(true))
  }, [view, period])

  useEffect(() => {
    if (enabled) reload()
  }, [enabled, reload])

  return { data, failed, reload }
}
