import { motion } from 'framer-motion'
import { History, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import { actionLabel, describeAuditEntry, formatDateTime } from '../../lib/auditLog'

const PAGE_SIZE = 25

// One person's history: what they did, and what was done to their account.
//
// Both halves, which is the whole point of having this screen separately from
// the main audit log. Filtering the log by user shows only the first half —
// the actor — so the fact that an administrator suspended them last Tuesday
// would be missing, and that is usually the half somebody opening this came
// for. The endpoint returns both.
export default function UserAuditDrawer({ user, onClose }) {
  const [data, setData] = useState(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    setData(null)
    api.get(`/admin/users/${user.id}/audit-logs`, {
      params: { limit: PAGE_SIZE, offset },
    })
      .then((r) => setData(r.data))
      .catch(() => setData({ total_count: 0, items: [] }))
  }, [user.id, offset])

  const total = data?.total_count ?? 0

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 200 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="card card-pad"
        style={{
          width: 'min(720px, 92vw)',
          height: '100%',
          borderRadius: 0,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <History size={18} />
            <h3 id="history-title" style={{ fontSize: 16 }}>
              {user.full_name} · activity
            </h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <p className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>
          Everything {user.username} did, and everything done to their account.
          Read-only — audit entries cannot be edited or removed.
        </p>

        {data === null ? (
          <Loading label="Loading history" />
        ) : data.items.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            hint="Activity appears here as soon as this account is used."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>What happened</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id}>
                      <td className="dim tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                        {formatDateTime(e.created_at)}
                      </td>
                      <td><span className="pill pill-dim">{actionLabel(e.action)}</span></td>
                      <td style={{ fontSize: 13 }}>{describeAuditEntry(e)}</td>
                      <td>
                        <span className={`pill ${e.result === 'Failure' ? 'pill-red' : 'pill-green'}`}>
                          {e.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row between mt-16">
              <span className="dim" style={{ fontSize: 12.5 }}>
                Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Prev
                </button>
                <button
                  className="btn btn-sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
