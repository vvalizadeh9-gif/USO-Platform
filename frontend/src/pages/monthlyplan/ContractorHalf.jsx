import { AlertCircle } from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { SHAMSI_MONTHS } from '../../lib/shamsi'
import {
  ANSWERING,
  MAX_COMMITTED,
  REASONS,
  pace,
  parseCount,
  planState,
  shortShamsi,
} from './contractorPlan'
import { figure } from './figures'
import { MISS } from './streams'

const NO_PLAN = '#B9BDC4'
const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.value, r.label]))

/** Farsi text inside an English page: its own direction and font. */
export function Fa({ children }) {
  return (
    <bdi className="cp-fa" dir="rtl" lang="fa">
      {children}
    </bdi>
  )
}

/**
 * One stream's half of the contractor's Monthly Plan: KPI cards for the
 * month now running, the plan block for the month picked, and the trend.
 * DT Delivery and Acceptance are the same component with different data;
 * Acceptance has no Assignment, so one card fewer and no assignment band.
 */
export default function ContractorHalf({
  stream, selected, running, versions, when, value, error, busy, onChange, onChanged,
}) {
  const current = selected.current_month
  const plan = selected.planning
  const titleId = `cp-${stream.key}-title`
  const found = selected.history.find(
    (h) => h.shamsi_year === plan.shamsi_year && h.shamsi_month === plan.shamsi_month,
  )
  // The running month's bar reads the same figures as its KPI cards.
  const point = found?.in_progress
    ? { ...found, assignment: current.assignment, pip: current.pip, delivered: current.delivered }
    : found

  return (
    <section className="card cp-half" style={{ '--cp-accent': stream.accent }} aria-labelledby={titleId} data-stream={stream.key}>
      <div className="cp-half-head">
        <h2 id={titleId}>{stream.title}</h2>
        <span className="cp-caption">
          {stream.unit} · <Fa>{current.label}</Fa> so far
        </span>
      </div>

      <Kpis stream={stream} current={current} runningPlan={running.planning} />

      <div className="cp-block">
        <h3 className="cp-block-title">
          {when === 'running' ? 'Your plan this month' : <>Your plan for <Fa>{plan.label}</Fa></>}
        </h3>
        {point && (
          <PlanBar
            stream={stream}
            point={point}
            expected={point.in_progress ? current.expected_by_today : null}
          />
        )}
        <PlanState
          stream={stream}
          plan={plan}
          when={when}
          value={value}
          error={error}
          busy={busy}
          onChange={onChange}
          onChanged={onChanged}
        />
        <Versions versions={versions} />
      </div>

      <Trend stream={stream} history={selected.history} />
    </section>
  )
}

// ------------------------------------------------------------------ KPIs
function Kpis({ stream, current, runningPlan }) {
  const standing = pace(current)
  const share = current.pip != null && current.assignment
    ? Math.round((100 * current.pip) / current.assignment)
    : null

  let pipSub = 'Not approved yet'
  if (runningPlan.status === 'RevisionRequested' && runningPlan.in_force_version) {
    pipSub = `Approved v${runningPlan.in_force_version} · stays until PM decides`
  } else if (runningPlan.in_force_version) {
    pipSub = `Approved v${runningPlan.in_force_version}`
  } else if (runningPlan.status === 'Submitted') {
    pipSub = 'Waiting for PM'
  }

  let paceSub = current.pip == null ? 'No PIP to pace against' : ''
  let behind = false
  if (standing) {
    const { expected, diff } = standing
    behind = diff < 0
    paceSub =
      diff === 0
        ? `On pace · target today ${expected}`
        : diff > 0
          ? `${diff} ahead · target today ${expected}`
          : `${-diff} behind · target today ${expected}`
  }

  return (
    <div className={`cp-kpis ${stream.hasAssignment ? 'cp-kpis-3' : 'cp-kpis-2'}`}>
      {stream.hasAssignment && (
        <Kpi
          label="Your assignment"
          value={figure(current.assignment)}
          sub={share != null ? `Your PIP covers ${share}% of it` : 'Sites you hold this month'}
        />
      )}
      <Kpi label="Your PIP" value={figure(current.pip)} sub={pipSub} />
      <Kpi label="Delivered" value={figure(current.delivered)} sub={paceSub} behind={behind} />
    </div>
  )
}

function Kpi({ label, value, sub, behind }) {
  return (
    <div className="cp-kpi">
      <div className="cp-kpi-label">{label}</div>
      <div className="cp-kpi-value">{value}</div>
      {sub && <div className={behind ? 'cp-kpi-sub cp-behind' : 'cp-kpi-sub'}>{sub}</div>}
    </div>
  )
}

// ------------------------------------------------------------- the bar
function PlanBar({ stream, point, expected }) {
  const { delivered, pip } = point
  const assignment = stream.hasAssignment ? point.assignment : null
  const max = Math.max(1, assignment ?? 0, pip ?? 0, delivered, expected ?? 0)
  const at = (v) => `${Math.min(100, (100 * v) / max)}%`

  const words = [
    pip != null ? `Delivered ${delivered} of ${pip}` : `Delivered ${delivered}, no PIP`,
    expected != null ? `today's target ${expected}` : null,
    assignment != null ? `assignment ${assignment}` : null,
  ].filter(Boolean).join(', ')

  const left = pip != null ? pip - delivered : null

  return (
    <div className="cp-bar-wrap">
      <div className="cp-bar-text">
        <b>{delivered}</b>
        {pip != null ? (
          <> of {pip} · {left > 0 ? `${left} to go` : left === 0 ? 'target met' : `${-left} over`}</>
        ) : (
          <> delivered · no PIP</>
        )}
      </div>
      <div className="cp-bar" role="img" aria-label={words}>
        {assignment != null && <span className="cp-bar-band" style={{ width: at(assignment) }} />}
        <span className="cp-bar-fill" style={{ width: at(delivered) }} />
        {expected != null && <span className="cp-bar-today" style={{ insetInlineStart: at(expected) }} />}
        {pip != null && <span className="cp-bar-pip" style={{ insetInlineStart: at(pip) }} />}
      </div>
      <div className="cp-legend" aria-hidden="true">
        <span><i className="cp-key-fill" />Delivered</span>
        {pip != null && <span><i className="cp-key-pip" />Your PIP</span>}
        {expected != null && <span><i className="cp-key-today" />Today’s target</span>}
        {assignment != null && <span><i className="cp-key-band" />Assignment</span>}
      </div>
    </div>
  )
}

// ------------------------------------------------------- the plan state
function Pill({ tone, children }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

function PlanState({ stream, plan, when, value, error, busy, onChange, onChanged }) {
  const state = planState(plan)
  const [asking, setAsking] = useState(false)
  const id = `cp-count-${stream.key}`
  const days = plan.days_remaining

  if (state === 'edit') {
    const answering = ANSWERING.includes(plan.status)
    return (
      <div className="cp-state" data-state="edit">
        {answering && plan.return_comment && (
          // Text, never markup: typed by one user and read by another.
          <div className="cp-note" role="status">
            <div className="cp-note-who">
              <AlertCircle size={14} aria-hidden="true" />
              {plan.returned_by ? `${plan.returned_by}, PM` : 'The PM'} sent this back
            </div>
            <div className="cp-note-msg">{plan.return_comment}</div>
          </div>
        )}
        <div className="cp-state-row">
          <Pill tone={answering ? 'pill-amber' : 'pill-dim'}>{plan.status || 'Not submitted'}</Pill>
          <span className="cp-state-note">
            Due {plan.deadline_shamsi} ·{' '}
            {days < 0
              ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`
              : days === 0
                ? 'due today'
                : `${days} day${days === 1 ? '' : 's'} left`}
          </span>
        </div>
        <label className="cp-field" htmlFor={id}>
          <span>Your PIP for <Fa>{plan.shamsi_month_name}</Fa></span>
        </label>
        <input
          id={id}
          className="input cp-input tnum"
          type="number"
          min="0"
          max={MAX_COMMITTED}
          step="1"
          inputMode="numeric"
          disabled={busy}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {error && (
          <div id={`${id}-error`} className="cp-error" role="alert">
            {error}
          </div>
        )}
      </div>
    )
  }

  if (state === 'missed') {
    return (
      <div className="cp-state" data-state="missed">
        <div className="cp-state-row">
          <Pill tone="pill-amber">Not submitted</Pill>
          <span className="cp-state-note">Not submitted — deadline passed</span>
        </div>
      </div>
    )
  }

  if (state === 'waiting') {
    return (
      <div className="cp-state" data-state="waiting">
        <div className="cp-state-row">
          <Pill tone="pill-amber">Submitted</Pill>
          <span className="cp-state-note">Waiting for PM</span>
          <span className="cp-state-num tnum">{figure(plan.committed_count)}</span>
        </div>
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div className="cp-state" data-state="pending">
        <div className="cp-state-row">
          <Pill tone="pill-violet">Revision requested</Pill>
          <span className="cp-state-note">
            Revision {plan.in_force_count}→{plan.committed_count} · with PM
          </span>
        </div>
        <div className="cp-state-note">Until PM approves, {plan.in_force_count} counts.</div>
      </div>
    )
  }

  const kept = plan.in_force_count ?? plan.committed_count
  if (state === 'revisable') {
    return (
      <div className="cp-state" data-state="revisable">
        {plan.status === 'RevisionReturned' && plan.return_comment && (
          <div className="cp-note" role="status">
            <div className="cp-note-who">
              <AlertCircle size={14} aria-hidden="true" />
              {plan.returned_by ? `${plan.returned_by}, PM` : 'The PM'} kept {plan.in_force_count}
            </div>
            <div className="cp-note-msg">{plan.return_comment}</div>
          </div>
        )}
        <div className="cp-state-row">
          <Pill tone="pill-green">Approved</Pill>
          <span className="cp-state-num tnum">{figure(kept)}</span>
          <span className="cp-state-note">You can ask for a change until day 15.</span>
        </div>
        {asking ? (
          <RevisionForm
            stream={stream}
            plan={plan}
            onCancel={() => setAsking(false)}
            onSent={() => {
              setAsking(false)
              onChanged?.()
            }}
          />
        ) : (
          <button type="button" className="btn cp-btn-lg" onClick={() => setAsking(true)}>
            Request revision
          </button>
        )}
      </div>
    )
  }

  // final
  return (
    <div className="cp-state" data-state="final">
      <div className="cp-state-row">
        <Pill tone="pill-green">{when === 'future' ? 'Approved' : 'Final'}</Pill>
        <span className="cp-state-num tnum">{figure(kept)}</span>
        <span className="cp-state-note">
          {when === 'future'
            ? 'Your target for the month. Changes open once it starts, until day 15.'
            : 'Final — this is the number you are measured against.'}
        </span>
      </div>
    </div>
  )
}

function RevisionForm({ stream, plan, onCancel, onSent }) {
  const toast = useToast()
  const [count, setCount] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const base = `cp-rev-${stream.key}`

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
        year: plan.shamsi_year,
        month: plan.shamsi_month,
        stream: stream.key,
        committed_count: value,
        reason,
        comment: comment.trim() || undefined,
      })
      toast.success('Revision requested', `${plan.in_force_count} stays in force until the PM decides.`)
      onSent()
    } catch (err) {
      toast.error(`Could not request a ${stream.name} revision`, err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cp-rev">
      <div className="cp-rev-grid">
        <label className="cp-field" htmlFor={`${base}-count`}>
          <span>New {stream.name} PIP</span>
          <input
            id={`${base}-count`}
            className="input cp-input tnum"
            type="number"
            min="0"
            max={MAX_COMMITTED}
            step="1"
            inputMode="numeric"
            value={count}
            disabled={busy}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <label className="cp-field" htmlFor={`${base}-reason`}>
          <span>Reason</span>
          <select id={`${base}-reason`} className="input cp-input" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="cp-field" htmlFor={`${base}-comment`}>
        <span>Comment{reason === 'OTHER' ? '' : ' (optional)'}</span>
        <input id={`${base}-comment`} className="input cp-input" value={comment} disabled={busy} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="cp-rev-actions">
        <button type="button" className="btn btn-primary cp-btn-lg" disabled={busy} onClick={send}>
          Send to PM
        </button>
        <button type="button" className="btn btn-ghost cp-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------- versions
function versionWhen(v) {
  const day = (s) => shortShamsi(s, SHAMSI_MONTHS)
  if (v.status === 'Approved') return `Approved · ${day(v.decided_shamsi)}`
  if (v.status === 'Submitted' || v.status === 'RevisionRequested') return `Waiting for PM · ${day(v.submitted_shamsi)}`
  if (v.status === 'Returned' || v.status === 'RevisionReturned') return `Returned · ${day(v.decided_shamsi)}`
  return v.status
}

function Versions({ versions }) {
  const rows = versions?.revisions ?? []
  if (rows.length === 0) return null
  return (
    <ol className="cp-versions" aria-label="Versions">
      {rows.map((v) => {
        const why = [
          v.revision_reason ? REASON_LABEL[v.revision_reason] || v.revision_reason : null,
          v.revision_comment,
          v.return_comment ? `PM: ${v.return_comment}` : null,
        ].filter(Boolean).join(' · ')
        return (
          <li key={v.version} className="cp-version">
            <span className="cp-version-v">v{v.version}</span>
            <span className="cp-version-n tnum">{figure(v.committed_count)}</span>
            <span className="cp-version-why">{why}</span>
            <span className="cp-version-when">{versionWhen(v)}</span>
          </li>
        )
      })}
    </ol>
  )
}

// ------------------------------------------------------------------ trend
function Trend({ stream, history }) {
  const closed = history.filter((h) => !h.in_progress && h.pip != null)
  const hit = closed.filter((h) => h.delivered >= h.pip).length
  const max = Math.max(1, ...history.map((h) => Math.max(h.delivered, h.pip ?? 0)))
  const y = (v) => 100 - (100 * v) / max
  const n = history.length

  // The PIP line, broken where a month had no plan.
  const segments = []
  let current = []
  history.forEach((h, i) => {
    if (h.pip == null) {
      if (current.length) segments.push(current)
      current = []
    } else {
      current.push(`${((i + 0.5) / n) * 100},${y(h.pip)}`)
    }
  })
  if (current.length) segments.push(current)

  const words = history
    .map((h) =>
      h.pip == null
        ? `${h.label}: ${h.delivered} delivered, no plan`
        : `${h.label}: ${h.delivered} of ${h.pip}${h.in_progress ? ', month running' : h.delivered >= h.pip ? ', hit' : ', missed'}`,
    )
    .join('; ')

  return (
    <div className="cp-trend">
      <div className="cp-block-title">
        Last {n} months · {closed.length
          ? `hit ${hit} of the last ${closed.length} closed month${closed.length === 1 ? '' : 's'}`
          : 'no closed month with a plan yet'}
      </div>
      <div className="cp-trend-chart" role="img" aria-label={`${stream.title}, last ${n} months: ${words}`}>
        {history.map((h) => {
          // The running month is not judged yet: its own lighter colour, not
          // a miss, until it closes.
          const color = h.pip == null
            ? NO_PLAN
            : h.in_progress || h.delivered >= h.pip ? stream.accent : MISS
          return (
            <div key={`${h.shamsi_year}-${h.shamsi_month}`} className="cp-trend-col">
              <span className="cp-trend-val tnum">
                {h.pip == null ? 'no plan' : `${h.delivered}/${h.pip}`}
              </span>
              <div className="cp-trend-area">
                <span
                  className="cp-trend-bar"
                  style={{
                    height: `${(100 * h.delivered) / max}%`,
                    background: color,
                    opacity: h.in_progress ? 0.45 : 1,
                  }}
                />
              </div>
              <span className="cp-trend-month" dir="rtl" lang="fa">{h.shamsi_month_name}</span>
            </div>
          )
        })}
        <svg className="cp-trend-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {segments.map((pts, i) =>
            pts.length === 1 ? (
              <line
                key={i}
                x1={Number(pts[0].split(',')[0]) - 100 / n / 3}
                x2={Number(pts[0].split(',')[0]) + 100 / n / 3}
                y1={pts[0].split(',')[1]}
                y2={pts[0].split(',')[1]}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <polyline key={i} points={pts.join(' ')} vectorEffect="non-scaling-stroke" />
            ),
          )}
        </svg>
      </div>
      <div className="cp-legend" aria-hidden="true">
        <span><i style={{ background: stream.accent }} />Hit PIP</span>
        <span><i style={{ background: MISS }} />Missed</span>
        <span><i style={{ background: NO_PLAN }} />No plan</span>
        <span><i style={{ background: stream.accent, opacity: 0.45 }} />This month so far</span>
        <span><i className="cp-key-line" />Your PIP</span>
      </div>
    </div>
  )
}
