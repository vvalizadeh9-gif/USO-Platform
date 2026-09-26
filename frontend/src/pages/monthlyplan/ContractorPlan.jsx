import { motion } from 'framer-motion'
import { AlertCircle, History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { figure } from './figures'
import Revisions from './Revisions'
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

/** The two plans a contractor files every month, in the order they are read. */
const STREAMS = [
  { key: 'DT', name: 'DT', unit: 'drive tests', example: 'e.g. 40' },
  { key: 'ACCEPTANCE', name: 'Acceptance', unit: 'villages fully accepted', example: 'e.g. 25' },
]

/** Why a contractor may ask for an approved number to change. Same values as
 * the server's REVISION_REASONS; OTHER needs a comment. */
const REASONS = [
  { value: 'SITES_BLOCKED', label: 'Sites blocked' },
  { value: 'SCOPE_CHANGE', label: 'Scope change' },
  { value: 'PERMITS', label: 'Permits' },
  { value: 'OTHER', label: 'Other' },
]

/** The typed number, or null for "nothing typed", or undefined if it is not one. */
function parseCount(text) {
  const raw = (text ?? '').trim()
  if (raw === '') return null
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return value > MAX_COMMITTED ? undefined : value
}

const getMy = (year, month, stream) =>
  api.get('/pip/my', { params: { year, month, stream } }).then((r) => r.data)

/**
 * The contractor's own side of the monthly plan.
 *
 * One screen, in the order the person using it reads:
 *
 * 1. **Next month's two numbers** -- the DT PIP and the Acceptance PIP, on one
 *    form with one Submit. They are two plans on the server (one per
 *    stream), decided by the PM separately, so each number carries its own
 *    status, version, deadline and PM comment.
 * 2. **This month's approved numbers**, and -- until the end of day 15 -- a
 *    way to ask the PM to change one. The approved number stays in force
 *    until the PM approves the request.
 * 3. Where the running month stands in drive tests, and the six months behind
 *    it, from the same service the Drive Test dashboard reads.
 *
 * Three words carry the whole screen, and they mean the same here as
 * everywhere else on the platform. **Assignment** is the sites held in the
 * month, carried in plus newly assigned. **PIP** is what the PM approved.
 * **Delivered** is what was done.
 *
 * Nothing here names another company or shows MTN's internal target: every
 * call reads the caller's own contractor off their session.
 */
export default function ContractorPlan({ period }) {
  const toast = useToast()
  // Per stream: the planning month's context, and the running month's.
  const [planning, setPlanning] = useState(null)
  const [running, setRunning] = useState(null)
  const [counts, setCounts] = useState({ DT: '', ACCEPTANCE: '' })
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)

  const { year, month } = period

  const load = useCallback(async () => {
    setDenied(false)
    try {
      const [dt, acc] = await Promise.all([getMy(year, month, 'DT'), getMy(year, month, 'ACCEPTANCE')])
      const next = { DT: dt, ACCEPTANCE: acc }
      setPlanning(next)
      // The inputs follow the server's numbers on every load, including after
      // a submit: the value on screen should be the value on record.
      setCounts({
        DT: dt.planning?.committed_count == null ? '' : String(dt.planning.committed_count),
        ACCEPTANCE: acc.planning?.committed_count == null ? '' : String(acc.planning.committed_count),
      })

      // The month now running, for the revision block. When the picker is on
      // the running month already, those are the same two plans.
      const ry = dt.current_month?.shamsi_year
      const rm = dt.current_month?.shamsi_month
      if (!ry || !rm) setRunning(null)
      else if (ry === year && rm === month) setRunning(next)
      else {
        const [rdt, racc] = await Promise.all([getMy(ry, rm, 'DT'), getMy(ry, rm, 'ACCEPTANCE')])
        setRunning({ DT: rdt, ACCEPTANCE: racc })
      }
    } catch (err) {
      // A staff account reaching this screen, which the route guard should
      // have prevented -- but the server is what decides, and saying so
      // beats an empty card.
      if (err.response?.status === 403) setDenied(true)
      else toast.error('Could not load your plan', 'Please refresh.')
      setPlanning(null)
      setRunning(null)
    }
  }, [year, month, toast])

  useEffect(() => {
    load()
  }, [load])

  if (denied) {
    return (
      <EmptyState
        title="This form belongs to a contractor account"
        hint="Your account does not act for a contractor, so there is no plan here to fill in."
      />
    )
  }
  if (!planning) return <Loading label="Loading your plan" />

  const context = planning.DT
  const label = context.planning.label
  const runningMonth = context.current_month
  const editable = (stream) => {
    const status = planning[stream].planning.status
    return status == null || EDITABLE.includes(status)
  }
  const open = STREAMS.filter((s) => editable(s.key))

  async function submit() {
    for (const s of open) {
      const value = parseCount(counts[s.key])
      if (value === undefined) {
        toast.error(`Your ${s.name} PIP is not a number`, `A whole number between 0 and ${MAX_COMMITTED}.`)
        return
      }
      if (value === null) {
        toast.error(`Enter your ${s.name} PIP`, `Both numbers are handed in together. Enter the ${s.unit} you commit to.`)
        return
      }
    }
    setBusy(true)
    const done = []
    const failed = []
    // One call per stream, one after the other, so a failure can be named.
    for (const s of open) {
      try {
        await api.post('/pip/my', {
          year, month, stream: s.key, committed_count: parseCount(counts[s.key]), submit: true,
        })
        done.push(s.name)
      } catch (err) {
        failed.push(`${s.name}: ${err.response?.data?.detail || 'please try again'}`)
      }
    }
    setBusy(false)
    if (failed.length === 0) {
      toast.success('Handed in', `Your ${label} ${done.join(' and ')} PIP ${done.length > 1 ? 'are' : 'is'} with the PM.`)
    } else {
      toast.error(
        done.length ? `Only your ${done.join(' and ')} PIP was handed in` : 'Could not submit',
        failed.join(' · '),
      )
    }
    load()
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="card card-pad">
        <h2 className="pip-title">Planning {label}</h2>

        {STREAMS.map((s) => (
          <PlanRow
            key={s.key}
            stream={s}
            planning={planning[s.key].planning}
            value={counts[s.key]}
            onChange={(v) => setCounts((c) => ({ ...c, [s.key]: v }))}
            busy={busy}
            onHistory={() => setHistoryFor({ year, month, stream: s.key })}
          />
        ))}

        {open.length > 0 && (
          <div className="row" style={{ marginTop: 18, gap: 12 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submit}>
              {open.some((s) => ANSWERING.includes(planning[s.key].planning.status)) ? 'Resubmit' : 'Submit'}
            </button>
            {open.length < STREAMS.length && (
              <span className="dim" style={{ fontSize: 12.5 }}>
                Hands in your {open.map((s) => s.name).join(' and ')} PIP only; the other is with the PM already.
              </span>
            )}
          </div>
        )}

        {running && (
          <RevisionBlock
            running={running}
            onChanged={load}
            onHistory={(stream) =>
              setHistoryFor({
                year: runningMonth.shamsi_year,
                month: runningMonth.shamsi_month,
                stream,
              })
            }
          />
        )}

        {historyFor && (
          <Revisions
            period={historyFor}
            stream={historyFor.stream}
            isContractor
            onClose={() => setHistoryFor(null)}
          />
        )}

        <div className="pip-sep">
          <div className="pip-lbl">{runningMonth.label} — where you stand in drive tests</div>
          <FigureCards month={runningMonth} />
          <Standing month={runningMonth} />
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

/** One stream's number for the planning month: its field or locked figure,
 * its status and clock, and what the PM said about it. */
function PlanRow({ stream, planning, value, onChange, busy, onHistory }) {
  const status = planning.status
  const editable = status == null || EDITABLE.includes(status)
  const answering = ANSWERING.includes(status)
  const id = `pip-count-${stream.key}`
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
    <div className="pip-sep" data-stream={stream.key} style={{ marginTop: 18, paddingTop: 16 }}>
      <div className="row wrap between">
        <span className="pip-lbl">{stream.name} · {stream.unit}</span>
        <div className="row" style={{ gap: 8 }}>
          <StatusPill status={status || 'Not started'} />
          {planning.is_late && <span className="pill pill-amber">Handed in late</span>}
          {planning.version && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onHistory} aria-label={`${stream.name} PIP history`}>
              <History size={13} /> History
            </button>
          )}
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
              {planning.returned_by ? `${planning.returned_by}, PM` : 'The PM sent this back'}
            </div>
            <div className="pip-note-msg">{planning.return_comment}</div>
          </div>
        ) : (
          <div className="dim mt-8" style={{ fontSize: 12.5 }}>
            Returned earlier: “{planning.return_comment}”
          </div>
        )
      )}

      {editable ? (
        <div className="pip-entry" style={{ marginTop: 12 }}>
          <label className="pip-entry-field" htmlFor={id}>
            <span className="pip-lbl">Your {planning.shamsi_month_name} {stream.name} PIP</span>
            <input
              id={id}
              className="input pip-num tnum"
              type="number"
              min="0"
              max={MAX_COMMITTED}
              step="1"
              inputMode="numeric"
              disabled={busy}
              placeholder={stream.example}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
          <div className="pip-meta">
            Version {planning.version || 1} · {deadline}
          </div>
        </div>
      ) : (
        <div className="pip-entry" style={{ marginTop: 12 }}>
          <div className="pip-entry-field">
            <span className="pip-lbl">Your {planning.shamsi_month_name} {stream.name} PIP</span>
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
    </div>
  )
}

/**
 * The running month's approved numbers, and the way to ask for a change.
 *
 * Offered only for a stream with an approved PIP in force, and only while the
 * server says the revision window is open (until the end of day 15). The
 * server refuses a request outside it either way.
 */
function RevisionBlock({ running, onChanged, onHistory }) {
  const rows = STREAMS.map((s) => ({ stream: s, planning: running[s.key].planning })).filter(
    (r) => r.planning.in_force_count != null || r.planning.status === 'RevisionRequested',
  )
  if (rows.length === 0) return null
  const first = rows[0].planning

  return (
    <div className="pip-sep">
      <div className="pip-lbl">{first.label} — your approved PIP</div>
      {rows.map((r) => (
        <RevisionRow key={r.stream.key} stream={r.stream} planning={r.planning} onChanged={onChanged} onHistory={() => onHistory(r.stream.key)} />
      ))}
    </div>
  )
}

function RevisionRow({ stream, planning, onChanged, onHistory }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const pending = planning.status === 'RevisionRequested'
  const returned = planning.status === 'RevisionReturned'
  const canAsk = planning.revision_open && !pending && planning.in_force_count != null

  async function send() {
    const value = parseCount(count)
    if (value == null) {
      toast.error('Enter the new number', `A whole number between 0 and ${MAX_COMMITTED}.`)
      return
    }
    if (!reason) {
      toast.error('Pick a reason', 'Say why the number needs to change.')
      return
    }
    if (reason === 'OTHER' && !comment.trim()) {
      toast.error('Add a comment', '“Other” needs a short explanation for the PM.')
      return
    }
    setBusy(true)
    try {
      await api.post('/pip/my/revision-request', {
        year: planning.shamsi_year,
        month: planning.shamsi_month,
        stream: stream.key,
        committed_count: value,
        reason,
        comment: comment.trim() || undefined,
      })
      toast.success('Revision requested', `${planning.in_force_count} stays in force until the PM decides.`)
      setOpen(false)
      onChanged?.()
    } catch (err) {
      toast.error(`Could not request a ${stream.name} revision`, err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-revision={stream.key} style={{ marginTop: 12 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'baseline' }}>
        <span style={{ minWidth: 90, fontWeight: 600 }}>{stream.name}</span>
        <span className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>
          {figure(planning.in_force_count)}
        </span>
        {planning.in_force_version && <span className="pill pill-dim">v{planning.in_force_version}</span>}
        {pending && (
          <span className="pill pill-violet">
            Revision to {planning.committed_count} requested · {planning.in_force_count} stays in force
          </span>
        )}
        <div className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onHistory} aria-label={`${stream.name} revision history`}>
          <History size={13} /> History
        </button>
        {canAsk && !open && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            Request revision
          </button>
        )}
      </div>

      {returned && planning.return_comment && (
        <div className="pip-note" role="status">
          <div className="pip-note-who">
            <AlertCircle size={14} />
            {planning.returned_by ? `${planning.returned_by}, PM` : 'The PM'} kept {planning.in_force_count}
          </div>
          <div className="pip-note-msg">{planning.return_comment}</div>
        </div>
      )}

      {open && (
        <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
          <label className="pip-entry-field" style={{ gap: 4 }}>
            <span className="pip-lbl">New {stream.name} PIP</span>
            <input
              className="input tnum"
              type="number"
              min="0"
              max={MAX_COMMITTED}
              step="1"
              inputMode="numeric"
              style={{ width: 110 }}
              value={count}
              disabled={busy}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <label className="pip-entry-field" style={{ gap: 4 }}>
            <span className="pip-lbl">Reason</span>
            <select className="input" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose…</option>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="pip-entry-field" style={{ gap: 4, flex: 1, minWidth: 180 }}>
            <span className="pip-lbl">Comment{reason === 'OTHER' ? '' : ' (optional)'}</span>
            <input className="input" value={comment} disabled={busy} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={send}>
            Send to PM
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
