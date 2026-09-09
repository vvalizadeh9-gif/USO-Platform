import { motion } from 'framer-motion'
import { CheckCircle2, CornerUpLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

// The one status a PM can act on. Approve and Return both come off Submitted
// and nothing else -- see ALLOWED_TRANSITIONS in services/monthly_plan.py.
const DECIDABLE = 'Submitted'

const TOTAL_CELL = { padding: '13px 16px', fontSize: 13.5 }

const sum = (rows, field) =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0)

/**
 * The month's plans, one row per contractor.
 *
 * Driven by the contractors, not by the plans that arrived: a queue of only
 * what was submitted cannot show the PM who is missing, and who is missing on
 * day four is the reason to open this screen at all.
 *
 * ``canDecide`` is the PM. Everyone else here -- Coordinator, Regional
 * Manager, Viewer -- reads it, and gets no decision panel, because the target
 * is the PM's to set. The server says the same thing and is what enforces it.
 */
export default function PlanQueue({ period, canDecide }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [denied, setDenied] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const { year, month } = period

  const load = useCallback(() => {
    setDenied(false)
    api
      .get('/pip/queue', { params: { year, month } })
      .then((r) => setData(r.data))
      .catch((err) => {
        if (err.response?.status === 403) setDenied(true)
        else toast.error('Could not load the queue', 'Please refresh.')
        setData(null)
      })
  }, [year, month, toast])

  useEffect(load, [load])

  // A month change is a different queue; a selection made in the old one
  // points at a plan that is not on screen any more.
  useEffect(() => {
    setSelectedId(null)
    setComment('')
  }, [year, month])

  if (denied) {
    return (
      <EmptyState
        title="This queue is not yours to read"
        hint="Monthly plans are visible to the PM, coordinators, regional managers and viewers."
      />
    )
  }
  if (!data) return <Loading label="Loading the month" />

  const rows = data.rows
  const selected = rows.find((r) => r.contractor_id === selectedId) || null
  const awaiting = rows.filter((r) => r.status === DECIDABLE).length
  const missing = rows.filter((r) => !r.status).length

  function select(row) {
    setSelectedId(row.contractor_id === selectedId ? null : row.contractor_id)
    // The PM's comment belongs to the plan they are deciding, so it does not
    // follow them to the next row.
    setComment('')
  }

  async function decide(action) {
    if (!selected?.plan_id) return
    setBusy(true)
    try {
      if (action === 'approve') {
        await api.post(`/pip/${selected.plan_id}/approve`)
        toast.success(
          `${selected.contractor_name} approved`,
          `${selected.committed_count} drive tests is their target for ${data.shamsi_month_name}.`,
        )
      } else {
        await api.post(`/pip/${selected.plan_id}/return`, { comment })
        toast.success(
          `Sent back to ${selected.contractor_name}`,
          'They see your comment on their own plan.',
        )
      }
      setSelectedId(null)
      setComment('')
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <b style={{ fontFamily: 'var(--font-display)', fontSize: 14.5 }}>
          {data.shamsi_month_name} {data.shamsi_year}
        </b>
        <span className="pill pill-amber">{awaiting} awaiting a decision</span>
        {missing > 0 && <span className="pill pill-dim">{missing} not submitted</span>}
        <span className="dim" style={{ fontSize: 12.5 }}>
          Due {data.deadline_shamsi}{data.deadline_passed ? ' — passed' : ''}
        </span>
      </motion.div>

      {rows.length === 0 ? (
        <EmptyState
          title="No contractors"
          hint="Nobody is active in the programme for this month."
        />
      ) : (
        /* Scrolls sideways rather than clipping: .table-wrap hides its
           overflow to keep the corners round, and five columns do not fit a
           phone. */
        <motion.div variants={fadeUp} className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Proposed</th>
                <th style={{ textAlign: 'right' }}>Last month</th>
                <th style={{ textAlign: 'right' }}>Version</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.contractor_id}
                  style={
                    row.contractor_id === selectedId
                      ? { background: 'var(--signal-glow)' }
                      : undefined
                  }
                >
                  <td className="text-data">
                    {canDecide ? (
                      // A button, not a click handler on the row: the PM
                      // reaching this by keyboard has to be able to open the
                      // same panel as the one reaching it by mouse.
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: 0, fontFamily: 'var(--font-farsi)', fontSize: 14.5, color: 'var(--signal-strong)', fontWeight: 500 }}
                        onClick={() => select(row)}
                      >
                        {row.contractor_name}
                      </button>
                    ) : (
                      row.contractor_name
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <StatusPill status={row.status || 'Not submitted'} />
                      {row.is_late && <span className="pill pill-amber">Late</span>}
                    </div>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {row.committed_count ?? '—'}
                  </td>
                  <td className="tnum dim" style={{ textAlign: 'right' }}>
                    {row.previous_month_committed ?? '—'}
                  </td>
                  <td className="tnum dim" style={{ textAlign: 'right' }}>
                    {row.version ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* Only tbody cells are padded by the stylesheet, so the totals
                  row carries its own -- it is one row on one screen, not a
                  new rule for every table in the platform. */}
              <tr style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                <td style={{ ...TOTAL_CELL, fontWeight: 600 }}>
                  Total — {rows.length} contractor{rows.length === 1 ? '' : 's'}
                </td>
                <td style={TOTAL_CELL} />
                <td className="tnum" style={{ ...TOTAL_CELL, textAlign: 'right', fontWeight: 600 }}>
                  {sum(rows, 'committed_count')}
                </td>
                <td className="tnum dim" style={{ ...TOTAL_CELL, textAlign: 'right' }}>
                  {sum(rows, 'previous_month_committed')}
                </td>
                <td style={TOTAL_CELL} />
              </tr>
            </tfoot>
          </table>
        </motion.div>
      )}

      {canDecide && selected && (
        <motion.div
          className="card card-pad mt-16"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="row wrap between" style={{ marginBottom: 12 }}>
            <b className="text-data-lg">{selected.contractor_name}</b>
            <StatusPill status={selected.status || 'Not submitted'} />
          </div>

          <div className="row wrap" style={{ gap: 24, marginBottom: 14 }}>
            <div>
              <div className="dim" style={{ fontSize: 12 }}>Proposed</div>
              <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
                {selected.committed_count ?? '—'}
              </div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 12 }}>Last month, approved</div>
              <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
                {selected.previous_month_committed ?? '—'}
              </div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 12 }}>Version</div>
              <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>
                {selected.version ?? '—'}
              </div>
            </div>
          </div>

          {selected.return_comment && (
            <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
              You sent this back earlier: “{selected.return_comment}”
            </div>
          )}

          {selected.status === DECIDABLE ? (
            <>
              <label className="field" htmlFor="pip-comment">
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>
                  Comment — required to return, and the contractor reads it
                </span>
                <textarea
                  id="pip-comment"
                  className="input"
                  rows={2}
                  maxLength={1000}
                  disabled={busy}
                  placeholder="What is wrong with this number, and what do you want instead?"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <div className="row wrap" style={{ gap: 9 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => decide('approve')}
                >
                  <CheckCircle2 size={14} /> Approve
                </button>
                {/* Disabled until there is something to send back with. A
                    number returned without a reason tells the contractor the
                    PM disagreed and nothing about what to write instead --
                    the server refuses an empty one for the same reason. */}
                <button
                  className="btn"
                  disabled={busy || !comment.trim()}
                  onClick={() => decide('return')}
                >
                  <CornerUpLeft size={14} /> Return
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {selected.status === 'Approved'
                ? 'Approved and locked. The contractor may open a revision, which arrives here as a new version.'
                : selected.status
                  ? `Nothing to decide: this plan is ${selected.status.toLowerCase()} and is with the contractor.`
                  : 'This contractor has not filed a plan for the month.'}
            </p>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
