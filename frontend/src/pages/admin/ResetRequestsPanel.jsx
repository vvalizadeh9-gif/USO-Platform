import { motion } from 'framer-motion'
import { KeyRound, LifeBuoy, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { detailMessage } from '../../lib/apiError'
import { formatDateTime } from '../../lib/auditLog'

// People who said, from the sign-in page, that they cannot get in.
//
// Shown at the top of the Users tab rather than behind a tab of its own, and
// hidden entirely when the queue is empty. It is an inbox: it earns space only
// when there is something in it, and when there is, it should be the first
// thing on the screen — somebody is locked out and waiting.
//
// A request grants nothing. It is a message; the administrator verifies who
// they are talking to by whatever means they already use, then issues a
// temporary password. A request naming an account nobody recognises is
// dismissed, and a run of those is worth noticing.
export default function ResetRequestsPanel({ version, onResetUser, onChanged }) {
  const toast = useToast()
  const [requests, setRequests] = useState([])

  useEffect(() => {
    api.get('/admin/password-reset-requests')
      .then((r) => setRequests(r.data))
      .catch(() => setRequests([]))
  }, [version])

  async function dismiss(request) {
    try {
      await api.post(`/admin/password-reset-requests/${request.id}/dismiss`, {
        reason: 'Dismissed from the admin console',
      })
      toast.success('Request dismissed')
      onChanged()
    } catch (err) {
      toast.error('Could not dismiss the request', detailMessage(err, 'Please try again.'))
    }
  }

  if (requests.length === 0) return null

  return (
    <motion.div
      className="card card-pad mb-16"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ borderColor: 'var(--amber)', borderWidth: 1.5 }}
    >
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <LifeBuoy size={16} />
        <h3 style={{ fontSize: 15 }}>
          {requests.length} password reset request{requests.length === 1 ? '' : 's'}
        </h3>
      </div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
        Check who you are talking to before resetting anything — this queue is
        open to anyone who can load the sign-in page, and a request proves
        nothing on its own.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Typed</th>
              <th>Matched account</th>
              <th>From</th>
              <th style={{ width: 200 }}></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="dim tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {formatDateTime(r.requested_at)}
                </td>
                <td className="text-data">{r.submitted_identifier}</td>
                <td>
                  {r.user_id ? (
                    <span style={{ fontWeight: 500 }}>{r.user_full_name}</span>
                  ) : (
                    <span className="pill pill-red">no such account</span>
                  )}
                </td>
                <td className="dim tnum" style={{ fontSize: 12.5 }}>{r.requested_ip || '—'}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {r.user_id && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onResetUser({
                          id: r.user_id,
                          full_name: r.user_full_name,
                          username: r.username,
                        })}
                      >
                        <KeyRound size={13} /> Reset
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => dismiss(r)}>
                      <X size={13} /> Dismiss
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
