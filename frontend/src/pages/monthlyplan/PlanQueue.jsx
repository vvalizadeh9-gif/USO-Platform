import { motion } from 'framer-motion'
import { CheckCircle2, CornerUpLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { bandColor } from '../drivetest/format'
import { figure, sharePercent } from './figures'
import { FigureCards, Standing } from './Standing'

// The one status a PM can act on. Approve and Return both come off Submitted
// and nothing else -- see ALLOWED_TRANSITIONS in services/monthly_plan.py.
const DECIDABLE = 'Submitted'

const TOTAL_CELL = { padding: '13px 16px', fontSize: 13.5 }

const sum = (rows, field) =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0)

/** Delivered against PIP as a bar narrow enough to sit in a table cell. */
function MiniBar({ delivered, pip }) {
  const percent = sharePercent(delivered, pip)
  if (percent == null) {
    return <span className="dim" title="No PIP approved for this month">—</span>
  }
  return (
    <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
      <span className="pip-mini">
        <i style={{ width: `${Math.min(100, percent)}%`, background: bandColor(percent) }} />
      </span>
      <span className="pip-pcs tnum" style={{ color: bandColor(percent) }}>
        {percent}%
      </span>
    </span>
  )
}

/**
 * The month's plans, one row per contractor, against the month now running.
 *
 * Driven by the contractors, not by the plans that arrived: a queue of only
 * what was submitted cannot show the PM who is missing, and who is missing on
 * day four is the reason to open this screen at all.
 *
 * Two months are on this screen at once and keeping them apart is the whole
 * design. The header, the Proposed column and every decision are the month
 * being **decided** — next month. The three cards, the bar and the
 * Assignment/PIP/Delivered columns are the month being **worked** — this one.
 * A PM approving 45 for مهر is really asking whether this company, holding 52
 * sites and 44 short of finishing them, can do 45 more; that question has the
 * answer beside it now rather than one screen away.
 *
 * The vocabulary and the marks are the contractor's own screen's, imported
 * rather than rebuilt (see Standing.jsx): the number a contractor is shown
 * about themselves and the number their PM is shown about them are the same
 * number, drawn the same way.
 *
 * ``canDecide`` is the PM. Everyone else here -- Coordinator, Regional
 * Manager, Viewer, Admin -- reads it and gets no decision, because the target
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
  const running = data.current_month
  const selected = rows.find((r) => r.contractor_id === selectedId) || null
  const awaiting = rows.filter((r) => r.status === DECIDABLE).length
  const approved = rows.filter((r) => r.status === 'Approved').length
  const missing = rows.filter((r) => !r.status).length
  const days = data.days_remaining

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
          `${selected.committed_count} drive tests is their target for ${data.label}.`,
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
      <motion.div variants={fadeUp} className="card card-pad">
        <div className="row wrap between">
          <h2 className="pip-title">Deciding {data.label}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`pill ${awaiting ? 'pill-amber' : 'pill-dim'}`}>
              {awaiting} awaiting a decision
            </span>
            {approved > 0 && <span className="pill pill-green">{approved} approved</span>}
            {missing > 0 && <span className="pill pill-dim">{missing} not filed</span>}
          </div>
        </div>

        <div className="pip-meta" style={{ paddingBottom: 0, marginTop: 6 }}>
          Due {data.deadline_shamsi} ·{' '}
          <span className={days < 0 ? 'pip-late' : undefined}>
            {days < 0
              ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past`
              : days === 0
                ? 'due today'
                : `${days} day${days === 1 ? '' : 's'} left`}
          </span>
        </div>

        {/* The month being worked, which is what the proposals are judged
            against. Same three words, same marks, same component as the
            contractor's own screen. */}
        <div className="pip-sep">
          <div className="pip-lbl">{running.label} — where the programme stands</div>
          <FigureCards month={running} />
          <Standing month={running} subject="programme" />
        </div>

        <div className="pip-sep">
          <div className="pip-lbl">Decisions</div>
          {rows.length === 0 ? (
            <EmptyState
              title="No contractors"
              hint="Nobody is active in the programme for this month."
            />
          ) : (
            /* Scrolls sideways rather than clipping: six columns do not fit a
               phone, and clipping one of them loses a figure. */
            <div className="table-wrap" style={{ overflowX: 'auto', marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Contractor</th>
                    <th style={{ textAlign: 'right' }}>
                      Assign.<br /><span className="dim pip-th-sub">{running.shamsi_month_name}</span>
                    </th>
                    <th style={{ textAlign: 'right' }}>
                      PIP<br /><span className="dim pip-th-sub">{running.shamsi_month_name}</span>
                    </th>
                    <th style={{ textAlign: 'right' }}>
                      Delivered<br /><span className="dim pip-th-sub">{running.shamsi_month_name}</span>
                    </th>
                    <th style={{ textAlign: 'right' }}>
                      Proposed<br /><span className="dim pip-th-sub">{data.shamsi_month_name}</span>
                    </th>
                    <th>Status</th>
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
                          // reaching this by keyboard has to be able to open
                          // the same panel as the one reaching it by mouse.
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
                      <td className="tnum pip-mid" style={{ textAlign: 'right' }}>
                        {row.assignment}
                      </td>
                      <td className="tnum pip-mid" style={{ textAlign: 'right' }}>
                        {figure(row.pip)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
                          <span className="tnum pip-mid">{row.delivered}</span>
                          <MiniBar delivered={row.delivered} pip={row.pip} />
                        </div>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        <span className="pip-proposed">{figure(row.committed_count)}</span>
                        {row.previous_month_committed != null && (
                          <div className="dim pip-th-sub">
                            was {row.previous_month_committed}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row wrap" style={{ gap: 7 }}>
                          <StatusPill status={row.status || 'Not filed'} />
                          {row.is_late && <span className="pill pill-amber">Late</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Only tbody cells are padded by the stylesheet, so the
                      totals row carries its own -- it is one row on one
                      screen, not a new rule for every table in the platform.

                      Assignment is not totalled here: it is a balance, and a
                      site open across two months is in both of them. The
                      programme's own figure is in the card above, computed
                      once rather than added up from rows. */}
                  <tr style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...TOTAL_CELL, fontWeight: 600 }}>
                      Total — {rows.length} contractor{rows.length === 1 ? '' : 's'}
                    </td>
                    <td className="tnum dim" style={{ ...TOTAL_CELL, textAlign: 'right' }}>
                      {running.assignment}
                    </td>
                    <td className="tnum" style={{ ...TOTAL_CELL, textAlign: 'right', fontWeight: 600 }}>
                      {figure(running.pip)}
                    </td>
                    <td className="tnum" style={{ ...TOTAL_CELL, textAlign: 'right', fontWeight: 600 }}>
                      {running.delivered}
                    </td>
                    <td className="tnum" style={{ ...TOTAL_CELL, textAlign: 'right', fontWeight: 600 }}>
                      {sum(rows, 'committed_count')}
                    </td>
                    <td style={TOTAL_CELL} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {canDecide && selected && (
          <motion.div
            className="pip-sep"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="row wrap between">
              <b className="text-data-lg">{selected.contractor_name}</b>
              <StatusPill status={selected.status || 'Not filed'} />
            </div>

            <div className="pip-meta" style={{ paddingBottom: 0, marginTop: 6 }}>
              Proposing <b className="tnum">{figure(selected.committed_count)}</b> for{' '}
              {data.label}, against {selected.assignment} held and {selected.delivered}{' '}
              delivered in {running.shamsi_month_name}
              {selected.version ? ` · version ${selected.version}` : ''}
            </div>

            {selected.return_comment && (
              <div className="dim mt-8" style={{ fontSize: 12.5 }}>
                You sent this back earlier: “{selected.return_comment}”
              </div>
            )}

            {selected.status === DECIDABLE ? (
              <div className="mt-16">
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
              </div>
            ) : (
              <p className="muted mt-8" style={{ fontSize: 13, lineHeight: 1.5 }}>
                {selected.status === 'Approved'
                  ? 'Approved and locked. Reopening an approved plan is not built yet — it needs the endpoint from the first of these changes.'
                  : selected.status
                    ? `Nothing to decide: this plan is ${selected.status.toLowerCase()} and is with the contractor.`
                    : 'This contractor has not filed a plan for the month.'}
              </p>
            )}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}
