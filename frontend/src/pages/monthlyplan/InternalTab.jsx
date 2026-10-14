import { useState } from 'react'
import api from '../../api/client'
import { SegmentedControl } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { buildBoard, initials, monthLabel } from './planBoard'
import { TabState } from './parts'
import { STREAM_LIST } from './streams'
import { formatNumber } from '../../lib/numbers'

const STEP = 5
const MAX_TARGET = 1_000_000
const fmt = (v) => formatNumber(v)
const percentOf = (part, whole) => (whole ? Math.round((100 * part) / whole) : null)

/**
 * Internal PIP: MTN's own target per stream, for the running month or the
 * planning month, against what the contractors cover.
 *
 * The target is the overview's `kpis.internal_pip` for the month on screen,
 * saved through PUT /pip/internal-target (a new version; the server refuses
 * anyone but the PM). Coverage is, for the running month, each contractor's
 * delivered; for the planning month, each shared plan's number from the
 * queue, waiting ones hatched.
 */
export default function InternalTab({ month, onMonth, running, planning, board, canSetTarget }) {
  const onRunning = month === 'running'
  const overview = onRunning ? running : planning.overview
  const options = [
    { key: 'running', label: <MonthOption period={running.period} word="running" /> },
    { key: 'planning', label: <MonthOption period={planning.period} word="planning" /> },
  ]

  const ready = overview.state === 'ready' && (onRunning || board.state === 'ready')
  const view = ready && !onRunning ? buildBoard(board) : null
  const period = onRunning ? running.period : planning.period

  return (
    <div className="mp-internal">
      <SegmentedControl options={options} value={month} onChange={onMonth} label="Month" className="mp-month-seg" />
      {!ready ? (
        <TabState
          state={overview.state !== 'ready' ? overview.state : board.state}
          what="Internal PIP"
          onRetry={() => {
            overview.reload()
            board.reload()
          }}
        />
      ) : (
        <div className="mp-list mp-internal-list">
          <div className="mp-list-head" aria-hidden="true">
            <span>Stream</span>
            <span>Internal PIP</span>
            <span>Coverage by contractors</span>
          </div>
          <ul aria-label={`Internal PIP, ${monthLabel(period)}`}>
            {STREAM_LIST.map((meta) => (
              <StreamRow
                key={`${month}-${meta.key}`}
                meta={meta}
                period={period}
                internal={overview.data[meta.key].kpis.internal_pip ?? null}
                coverage={
                  onRunning
                    ? runningCoverage(overview.data[meta.key])
                    : planningCoverage(view, meta.stream)
                }
                canSetTarget={canSetTarget}
                onSaved={overview.reload}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MonthOption({ period, word }) {
  return (
    <span className="mp-month-option">
      <span className="mp-fa">{monthLabel(period)}</span>
      <small>{word}</small>
    </span>
  )
}

/** The running month: each contractor's delivered, and the contractors' PIPs summed. */
function runningCoverage(stream) {
  const parts = stream.rows
    .filter((r) => r.delivered > 0)
    .map((r) => ({ id: r.contractor_id, name: r.name || '', value: r.delivered, waiting: false }))
  return { kind: 'running', parts, total: stream.kpis.delivered ?? 0, pips: stream.kpis.contractor_pip ?? null }
}

/** The planning month: every shared plan's number, from the queue. */
function planningCoverage(view, stream) {
  const parts = view.shared
    .map((c) => ({ c, cell: c.cells[stream] }))
    .filter(({ cell }) => cell.state !== 'none' && cell.number)
    .map(({ c, cell }) => ({ id: c.id, name: c.name, value: cell.number, waiting: cell.state === 'waiting' }))
  return {
    kind: 'planning',
    parts,
    total: parts.reduce((s, p) => s + p.value, 0),
    waiting: parts.filter((p) => p.waiting).length,
    notShared: view.contractors.filter((c) => c.cells[stream].state === 'none').length,
  }
}

function StreamRow({ meta, period, internal, coverage, canSetTarget, onSaved }) {
  return (
    <li className="mp-internal-row" data-stream={meta.stream}>
      <div>
        <div className="mp-strong">{meta.title}</div>
        <div className="mp-meta mp-fa">{monthLabel(period)}</div>
      </div>
      <div>
        {canSetTarget ? (
          <TargetStepper meta={meta} period={period} current={internal} onSaved={onSaved} />
        ) : (
          <span className="mp-target tnum">{fmt(internal)}</span>
        )}
      </div>
      <Coverage coverage={coverage} internal={internal} title={meta.title} />
    </li>
  )
}

/** − / number / + in steps of 5, and Save once the number has changed. Enter saves. */
function TargetStepper({ meta, period, current, onSaved }) {
  const toast = useToast()
  const [draft, setDraft] = useState(current == null ? '' : String(current))
  const [busy, setBusy] = useState(false)
  const raw = draft.trim()
  const value = /^\d+$/.test(raw) ? Number(raw) : null
  const valid = value != null && value <= MAX_TARGET
  const changed = valid && value !== current
  const base = value ?? current ?? 0

  async function save() {
    if (!changed || busy) return
    setBusy(true)
    try {
      await api.put('/pip/internal-target', {
        stream: meta.stream,
        year: period.year,
        month: period.month,
        target_count: value,
      })
      toast.success('Internal PIP saved')
      onSaved()
    } catch (err) {
      toast.error('Could not save the Internal PIP', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mp-stepper">
      <button
        type="button"
        className="mp-step"
        aria-label={`Decrease Internal PIP ${meta.title}`}
        disabled={busy || base <= 0}
        onClick={() => setDraft(String(Math.max(0, base - STEP)))}
      >
        −
      </button>
      <input
        className="mp-step-input tnum"
        type="number"
        inputMode="numeric"
        min={0}
        step={STEP}
        aria-label={`Internal PIP ${meta.title}`}
        aria-invalid={raw !== '' && !valid ? true : undefined}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          }
        }}
      />
      <button
        type="button"
        className="mp-step"
        aria-label={`Increase Internal PIP ${meta.title}`}
        disabled={busy}
        onClick={() => setDraft(String(Math.min(MAX_TARGET, base + STEP)))}
      >
        +
      </button>
      <button
        type="button"
        className="mp-btn mp-btn-primary"
        aria-label={`Save Internal PIP ${meta.title}`}
        disabled={!changed || busy}
        onClick={save}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function Coverage({ coverage, internal, title }) {
  const { parts, total } = coverage
  const scale = Math.max(internal ?? 0, total) * 1.1 || 1
  const at = (v) => `${(100 * v) / scale}%`
  const share = percentOf(total, internal)

  let sentence
  if (coverage.kind === 'running') {
    const gap = internal != null && coverage.pips != null ? internal - coverage.pips : null
    sentence = (
      <>
        <b className="tnum">{fmt(total)}</b> delivered
        {share != null && <> · <b className="tnum">{share}%</b> of Internal PIP</>}.
        {coverage.pips != null && (
          <>
            {' '}Contractor PIPs total <span className="tnum">{fmt(coverage.pips)}</span>
            {gap != null && gap !== 0 && <> ({fmt(Math.abs(gap))} {gap > 0 ? 'below' : 'above'} Internal PIP)</>}.
          </>
        )}
      </>
    )
  } else {
    const left = internal != null ? internal - total : null
    sentence = (
      <>
        <b className="tnum">{fmt(total)}</b> shared
        {share != null && <> · <b className="tnum">{share}%</b> of Internal PIP</>}.
        {left != null && <> {left > 0 ? `${fmt(left)} still to cover` : 'Fully covered'}.</>}{' '}
        {coverage.waiting} waiting for approval, {coverage.notShared} contractors have not shared.
      </>
    )
  }

  return (
    <div className="mp-coverage">
      <div
        className="mp-stack"
        role="img"
        aria-label={`${title}: ${parts.map((p) => `${p.name} ${p.value}${p.waiting ? ' waiting' : ''}`).join(', ') || 'nothing yet'}${internal != null ? `; Internal PIP ${internal}` : ''}`}
      >
        <span className="mp-stack-fill" style={{ width: at(total) }}>
          {parts.map((p, i) => (
            <span
              key={p.id}
              className="mp-stack-part mp-fa"
              data-alt={i % 2 === 1 || undefined}
              data-waiting={p.waiting || undefined}
              style={{ flexGrow: p.value }}
            >
              {initials(p.name)}
            </span>
          ))}
        </span>
        {internal != null && (
          <span className="mp-stack-mark" style={{ left: at(internal) }}>
            <em className="tnum">Internal {fmt(internal)}</em>
          </span>
        )}
      </div>
      <p className="mp-sentence">{sentence}</p>
      {parts.length > 0 && (
        <p className="mp-meta mp-legend">
          {parts.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              <bdi className="mp-fa">{p.name}</bdi> <span className="tnum">{fmt(p.value)}</span>
              {p.waiting && ' (waiting)'}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
