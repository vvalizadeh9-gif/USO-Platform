import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { figure } from './figures'
import SixMonthChart, { ChartLegend } from './SixMonthChart'
import { FigureCards, Standing } from './Standing'

// What the server accepts (services/monthly_plan.MAX_COMMITTED_COUNT). Checked
// here so a typo is refused where it was typed, not after a round trip; the
// server refuses it either way, which is what makes it a rule.
const MAX_COMMITTED = 10000

// The two states the contractor still owns. Anything else -- Submitted, which
// the PM is holding, or Approved, which is a target -- is read-only, and the
// server refuses an edit to either.
const EDITABLE = ['Draft', 'Returned', 'Reopened']

// The states in which the PM's comment is the first thing to read, rather than
// something that happened earlier. 'Reopened' is here for the state the PM's
// own screen creates; a server that does not produce it simply never matches.
const ANSWERING = ['Returned', 'Reopened']

/**
 * The contractor's own side of the monthly plan.
 *
 * One screen, in the order the person using it reads: what the PM said if they
 * said anything, the number being filed, where the month now running stands,
 * and the six months behind it. Everything arrives in one response
 * (GET /pip/my), because it is all one screen — and every figure on it comes
 * from the same service the Drive Test dashboard reads, so this page and that
 * one cannot report different numbers for the same month.
 *
 * Three words carry the whole screen, and they mean the same here as
 * everywhere else on the platform. **Assignment** is the sites held in the
 * month, carried in plus newly assigned. **PIP** is what the PM approved.
 * **Delivered** is drive tests done.
 */
export default function ContractorPlan({ period }) {
  const toast = useToast()
  const [context, setContext] = useState(null)
  const [count, setCount] = useState('')
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
        // after a submit: the value on screen should be the value on record,
        // and a half-typed one that survived a successful submit would read
        // as the one that was submitted.
        setCount(
          r.data.planning?.committed_count == null
            ? ''
            : String(r.data.planning.committed_count),
        )
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

  if (denied) {
    return (
      <EmptyState
        title="This form belongs to a contractor account"
        hint="Your account does not act for a contractor, so there is no plan here to fill in."
      />
    )
  }
  if (!context) return <Loading label="Loading your plan" />

  const planning = context.planning
  const running = context.current_month
  const status = planning.status
  const editable = status == null || EDITABLE.includes(status)
  const answering = ANSWERING.includes(status)

  /** The typed number, or null for "nothing typed", or undefined if it is not one. */
  function parsed() {
    const raw = count.trim()
    if (raw === '') return null
    if (!/^\d+$/.test(raw)) return undefined
    const value = Number(raw)
    return value > MAX_COMMITTED ? undefined : value
  }

  async function submit() {
    const value = parsed()
    if (value === undefined) {
      toast.error('That is not a number of drive tests', `A whole number between 0 and ${MAX_COMMITTED}.`)
      return
    }
    if (value === null) {
      toast.error('Nothing to submit', 'Enter the number you are committing to for this month.')
      return
    }
    setBusy(true)
    try {
      await api.post('/pip/my', { year, month, committed_count: value, submit: true })
      toast.success('Handed in', `Your ${planning.label} PIP is with the PM.`)
      load()
    } catch (err) {
      toast.error('Could not submit', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const days = planning.days_remaining
  const deadline = (
    <>
      due {planning.deadline_shamsi} ·{' '}
      <span className={days < 0 ? 'pip-late' : undefined}>
        {days < 0
          ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`
          : days === 0
            ? 'due today'
            : `${days} day${days === 1 ? '' : 's'} left`}
      </span>
    </>
  )

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="card card-pad">
        <div className="row wrap between">
          <h2 className="pip-title">Planning {planning.label}</h2>
          <div className="row" style={{ gap: 8 }}>
            <StatusPill status={status || 'Not started'} />
            {planning.is_late && <span className="pill pill-amber">Handed in late</span>}
          </div>
        </div>

        {/* What the PM said, directly above the field that answers it. Rendered
            as text and never as markup: the comment is typed by one user and
            read by another. */}
        {planning.return_comment && (
          answering ? (
            <div className="pip-note" role="status">
              <div className="pip-note-who">
                <AlertCircle size={14} />
                {planning.returned_by
                  ? `${planning.returned_by}, PM`
                  : 'The PM sent this back'}
              </div>
              <div className="pip-note-msg">{planning.return_comment}</div>
            </div>
          ) : (
            <div className="dim mt-8" style={{ fontSize: 12.5 }}>
              Returned earlier: “{planning.return_comment}”
            </div>
          )
        )}

        {/* The entry row: the number, the one thing to do with it, and the
            three facts about where it stands. */}
        {editable ? (
          <div className="pip-entry">
            <label className="pip-entry-field" htmlFor="pip-count">
              <span className="pip-lbl">Your {planning.shamsi_month_name} PIP</span>
              <input
                id="pip-count"
                className="input pip-num tnum"
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
            <button className="btn btn-primary" disabled={busy} onClick={submit}>
              {answering ? 'Resubmit' : 'Submit'}
            </button>
            <div className="pip-meta">
              Version {planning.version || 1} · {deadline}
            </div>
          </div>
        ) : (
          <div className="pip-entry">
            <div className="pip-entry-field">
              <span className="pip-lbl">Your {planning.shamsi_month_name} PIP</span>
              <span className="pip-locked tnum">{figure(planning.committed_count)}</span>
            </div>
            <div className="pip-meta">
              {status === 'Approved'
                ? 'Approved — this is your target for the month.'
                : 'Waiting on the PM. Ask for it to be returned if the number needs to change.'}
              {' · '}Version {planning.version || 1}
            </div>
          </div>
        )}

        <div className="pip-sep">
          <div className="pip-lbl">{running.label} — where you stand</div>
          <FigureCards month={running} />
          <Standing month={running} />
        </div>

        <div className="pip-sep">
          <div className="row wrap between">
            <div className="pip-lbl">Last {context.history.length} months</div>
            <ChartLegend />
          </div>
          <SixMonthChart months={context.history} />
        </div>
      </motion.div>
    </motion.div>
  )
}
