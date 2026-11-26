import { useCallback, useEffect, useState } from 'react'
import api from '../../../api/client'
import { detailMessage } from '../../../lib/apiError'
import { formatDateTime } from '../../../lib/auditLog'
import { describeHistory } from './accessModel'
import { SkeletonRows } from './RoleView'

const PAGE = 50

/** Every access change: who, when, what, before → after, reason. */
export default function HistoryPanel() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)

  const load = useCallback(async (offset = 0) => {
    setError(null)
    try {
      const { data } = await api.get('/admin/access/history', { params: { limit: PAGE, offset } })
      setTotal(data.total_count)
      setItems((prev) => (offset === 0 ? data.items : [...(prev || []), ...data.items]))
    } catch (err) {
      setError(detailMessage(err, 'Try again.'))
    }
  }, [])
  useEffect(() => { load(0) }, [load])

  return (
    <section className="ac-history card-fill" aria-label="Access history">
      {error && (
        <div className="ac-error" role="alert">
          <span>History could not be loaded. {error}</span>
          <button type="button" className="btn" onClick={() => load(0)}>Try again</button>
        </div>
      )}
      {!error && items === null && <SkeletonRows count={10} />}
      {!error && items && (
        <div className="table-scroll">
          {items.length === 0 ? <p className="ac-empty ac-empty-center">No access changes yet</p> : (
            <table className="ac-table">
              <thead>
                <tr><th>When</th><th>Who</th><th>Change</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {items.map((h) => (
                  <tr key={h.id}>
                    <td className="tnum">{formatDateTime(h.created_at)}</td>
                    <td>{h.who}</td>
                    <td>{describeHistory(h)}</td>
                    <td className="ac-reason">{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length < total && (
            <button type="button" className="btn ac-more" onClick={() => load(items.length)}>Show more</button>
          )}
        </div>
      )}
    </section>
  )
}
