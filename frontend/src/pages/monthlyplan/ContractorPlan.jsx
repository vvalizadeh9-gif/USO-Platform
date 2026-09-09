import { motion } from 'framer-motion'
import { AlertCircle, CalendarClock, ClipboardList, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { periodLabel } from '../../lib/shamsi'

// What the server accepts (services/monthly_plan.MAX_COMMITTED_COUNT). Checked
// here so a typo is refused where it was typed, not after a round trip; the
// server refuses it either way, which is what makes it a rule.
const MAX_COMMITTED = 10000

// The two states the contractor still owns. Anything else -- Submitted, which
// the PM is holding, or Approved, which is a target -- is read-only, and the
// server refuses an edit to either.
const EDITABLE = ['Draft', 'Returned']

const HISTORY_MONTHS = 6

/** One piece of context beside the number: what it is, and what it is. */
function Fact({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="label">
        <Icon size={14} strokeWidth={2} />
        {label}
      </div>
      <div className="value tnum" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/**
 * The contractor's own side of the monthly plan.
 *
 * One number for the month, and beside it the three things anybody deciding
 * that number actually looks at: what they committed last month, how much
 * work they are already carrying, and how long they have left. All of it
 * arrives in one response (GET /pip/my), because it is all one form.
 */
export default function ContractorPlan({ period }) {
  const toast = useToast()
  const [context, setContext] = useState(null)
  const [history, setHistory] = useState(null)
  const [count, setCount] = useState('')
  const [revising, setRevising] = useState(false)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)

  const { year, month } = period

  const load = useCallback(() => {
    setDenied(false)
    api
      .get('/pip/my', { params: { year, month } })
      .then((r) => {
        setContext(r.data)
        // The input follows the server's number on every load, including
        // after a save: the value on screen should be the value on record,
        // and a half-typed one that survived a successful submit would read
        // as the one that was submitted.
        setCount(
          r.data.plan?.committed_count == null ? '' : String(r.data.plan.committed_count),
        )
        setRevising(false)
      })
      .catch((err) => {
        // A staff account reaching this screen, which the route guard should
        // have prevented -- but the server is what decides, and saying so
        // beats an empty card.
        if (err.response?.status === 403) setDenied(true)
        else toast.error('Could not load your plan', 'Please refresh.')
        setContext(null)
      })
  }, [year, month, toast])

  useEffect(load, [load])

  useEffect(() => {
    api
      .get('/pip/my/history', { params: { months: HISTORY_MONTHS } })
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]))
  }, [year, month])

  if (denied) {
    return (
      <EmptyState
        title="This form belongs to a contractor account"
        hint="Your account does not act for a contractor, so there is no plan here to fill in."
      />
    )
  }
  if (!context) return <Loading label="Loading your plan" />

  const plan = context.plan
  const status = plan?.status || null
  const editable = !plan || EDITABLE.includes(status)
  const approved = status === 'Approved'

  /** The typed number, or null for "nothing typed", or undefined if it is not one. */
  function parsed() {
    const raw = count.trim()
    if (raw === '') return null
    if (!/^\d+$/.test(raw)) return undefined
    const value = Number(raw)
    return value > MAX_COMMITTED ? undefined : value
  }

  async function save(submit) {
    const value = parsed()
    if (value === undefined) {
      toast.error('That is not a number of drive tests', `A whole number between 0 and ${MAX_COMMITTED}.`)
      return
    }
    if (submit && value === null) {
      toast.error('Nothing to submit', 'Enter the number you are committing to for this month.')
      return
    }
    setBusy(true)
    try {
      await api.post('/pip/my', { year, month, committed_count: value, submit })
      toast.success(
        submit ? 'Handed in' : 'Saved',
        submit
          ? `Your ${periodLabel(year, month)} plan is with the PM.`
          : 'Kept as a draft. Nobody else sees it until you submit.',
      )
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function revise() {
    const value = parsed()
    if (value === undefined || value === null) {
      toast.error('Enter the new number', `A whole number between 0 and ${MAX_COMMITTED}.`)
      return
    }
    setBusy(true)
    try {
      await api.post('/pip/my/revise', { year, month, committed_count: value })
      toast.success(
        'Revision opened',
        'The approved figure stays on the record. Submit the new one when you are ready.',
      )
      load()
    } catch (err) {
      toast.error('Could not revise', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const deadlineTone = context.deadline_passed ? 'var(--amber)' : undefined

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row wrap between" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-dim)', fontWeight: 600 }}>
              YOUR COMMITMENT
            </div>
            <h2 className="text-data-lg" style={{ fontFamily: 'var(--font-display)', fontSize: 19, marginTop: 2 }}>
              {context.shamsi_month_name} {context.shamsi_year}
            </h2>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <StatusPill status={status || 'Not started'} />
            {plan?.version > 1 && <span className="pill pill-dim">Version {plan.version}</span>}
            {plan?.is_late && <span className="pill pill-amber">Handed in late</span>}
          </div>
        </div>

        {/* The PM's comment, where the person answering it is looking. Kept
            after a resubmission too, quietly: it is what the new number is
            answering, and the server keeps it for the same reason. */}
        {plan?.return_comment && (
          status === 'Returned' ? (
            <div
              className="form-banner"
              style={{ background: 'var(--amber-dim)', color: 'var(--amber)', marginTop: 14, marginBottom: 0 }}
              role="status"
            >
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <b style={{ display: 'block' }}>The PM sent this back</b>
                  <span style={{ fontWeight: 400, lineHeight: 1.5 }}>{plan.return_comment}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
              Returned earlier: “{plan.return_comment}”
            </div>
          )
        )}

        <div
          className="grid grid-kpi"
          style={{ marginTop: 16 }}
        >
          <Fact
            icon={ClipboardList}
            label="Last month, approved"
            value={context.previous_month_committed ?? '—'}
            sub={
              context.previous_month_committed == null
                ? 'No approved plan last month'
                : 'Most plans are this, adjusted'
            }
          />
          <Fact
            icon={ClipboardList}
            label="Sites you hold now"
            value={context.open_assignments}
            sub="Assigned and not yet drive-test done"
          />
          <Fact
            icon={CalendarClock}
            label="Due"
            value={context.deadline_shamsi}
            sub={context.deadline_passed ? 'The deadline has passed — file anyway' : 'Day 3 of the month'}
            tone={deadlineTone}
          />
        </div>

        <div style={{ marginTop: 20, maxWidth: 460 }}>
          {approved && !revising ? (
            <>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Drive tests committed</label>
                <div className="row" style={{ gap: 10 }}>
                  <span
                    className="tnum"
                    style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600 }}
                  >
                    {plan.committed_count}
                  </span>
                  <span className="pill pill-green"><Lock size={11} /> Locked</span>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                This is your target for the month. Revising keeps it on the record and
                opens a new version beside it, as a draft.
              </p>
              <button className="btn" onClick={() => setRevising(true)}>Revise</button>
            </>
          ) : !editable && !revising ? (
            /* Submitted: the number is with the PM, and the server refuses an
               edit to it until they hand it back. */
            <>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Drive tests committed</label>
                <span
                  className="tnum"
                  style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600 }}
                >
                  {plan.committed_count}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                Waiting on the PM. Ask for it to be returned if the number needs to change.
              </p>
            </>
          ) : (
            <>
              <label className="field" htmlFor="pip-count">
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>
                  Drive tests committed
                </span>
                <input
                  id="pip-count"
                  className="input"
                  type="number"
                  min="0"
                  max={MAX_COMMITTED}
                  step="1"
                  inputMode="numeric"
                  disabled={busy}
                  placeholder="e.g. 40"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </label>
              <div className="row wrap" style={{ gap: 9 }}>
                {revising ? (
                  <>
                    <button className="btn btn-primary" disabled={busy} onClick={revise}>
                      Open revision
                    </button>
                    <button className="btn" disabled={busy} onClick={() => { setRevising(false); load() }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn" disabled={busy} onClick={() => save(false)}>
                      Save draft
                    </button>
                    <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>
                      {status === 'Returned' ? 'Resubmit' : 'Submit'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="card">
        <div className="row" style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)' }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 14.5 }}>
            Your last {HISTORY_MONTHS} months
          </b>
        </div>
        {history === null ? (
          <Loading label="Loading history" />
        ) : (
          <div
            className="table-wrap"
            style={{ border: 'none', borderRadius: 0, boxShadow: 'none', overflowX: 'auto' }}
          >
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Committed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={`${row.shamsi_year}-${row.shamsi_month}`}>
                    <td className="text-data">{row.shamsi_month_name} {row.shamsi_year}</td>
                    {/* Only an approved figure is a commitment. A number still
                        being decided shows as a dash rather than as history. */}
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {row.committed_count ?? '—'}
                    </td>
                    <td><StatusPill status={row.status || 'Not submitted'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
