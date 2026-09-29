import { Check, Clock, PencilLine } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import api from '../../api/client'
import { Card, EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { periodLabel } from '../../lib/shamsi'
import HistoryDrawer from './HistoryDrawer'
import { STREAMS, buildBoard, initials } from './planBoard'
import { REASON_LABEL, streamMeta } from './streams'

const STREAM_TITLE = Object.fromEntries(STREAMS.map((s) => [s, streamMeta(s).title]))
const STREAM_SHORT = Object.fromEntries(STREAMS.map((s) => [s, streamMeta(s).short]))
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

/**
 * The Plans tab: who has shared a plan for the month being planned, and a
 * decision per stream on each one.
 *
 * Reads nothing of its own but the Internal PIP: the queue for every
 * stream (and for the running month) is the page's, because the tab badge
 * counts from the same responses (usePlanBoard, planBoard.buildBoard).
 *
 * Approve and Return are offered to `canDecide` (the PM) only, and act on
 * one stream's plan id. Everyone else reads the statuses. The server is
 * what enforces it: both endpoints refuse anyone but the PM.
 */
export default function PlansTab({ board, period, runningMonthName, canDecide, canSeeInternal, onDecided }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(null)
  const internal = useInternalTargets(period, canSeeInternal)

  if (board.state === 'denied') {
    return (
      <EmptyState
        title="These plans are not yours to read"
        hint="Monthly plans are visible to the PM, coordinators, regional managers and viewers."
      />
    )
  }
  if (board.state === 'failed') {
    return <div className="card"><div className="empty">Could not load the plans.</div></div>
  }
  if (board.state !== 'ready') return <Loading label="Loading the plans" />

  const view = buildBoard(board)
  const label = periodLabel(period.year, period.month)

  /** One decision on one plan id. Resolves true when it was saved. */
  async function decide(planId, action, comment, who) {
    setBusy(true)
    try {
      if (action === 'approve') {
        await api.post(`/pip/${planId}/approve`)
        toast.success(`${who} approved`, 'That number is now their PIP.')
      } else {
        await api.post(`/pip/${planId}/return`, { comment })
        toast.success(`Sent back to ${who}`, 'They see your comment on their own plan.')
      }
      onDecided()
      return true
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const decision = { canDecide, busy, decide }

  return (
    <div className="pl-tab">
      <div className="pl-top">
        <SharedCard view={view} />
        {canSeeInternal && <InternalCard totals={view.totals} internal={internal} />}
      </div>

      <div className="pl-lists">
        <NotSharedList contractors={view.notShared} />
        <SharedList
          contractors={view.shared}
          runningMonthName={runningMonthName}
          decision={decision}
          onOpenHistory={setHistory}
        />
      </div>

      {view.revisions.map((r) => (
        <RevisionCard key={r.planId} revision={r} runningMonthName={runningMonthName} decision={decision} />
      ))}

      {history && (
        <HistoryDrawer contractor={history} period={period} label={label} onClose={() => setHistory(null)} />
      )}
    </div>
  )
}

/** The Internal PIP for the month, per stream code, null while unread. */
function useInternalTargets(period, enabled) {
  const [targets, setTargets] = useState(null)
  const { year, month } = period
  useEffect(() => {
    if (!enabled || !year || !month) return undefined
    let live = true
    setTargets(null)
    Promise.all(
      STREAMS.map((stream) =>
        api
          .get('/pip/internal-target', { params: { stream, year, month } })
          .then((r) => r.data.current?.target_count ?? null)
          // Unreadable is shown as unset: the card is a comparison, and a
          // failed read has nothing to compare against.
          .catch(() => null),
      ),
    ).then((counts) => live && setTargets(Object.fromEntries(STREAMS.map((s, i) => [s, counts[i]]))))
    return () => {
      live = false
    }
  }, [enabled, year, month])
  return targets
}

// ------------------------------------------------------------------- A. cards
function SharedCard({ view }) {
  const total = view.contractors.length
  return (
    <Card className="pl-card pl-shared-card" aria-label="Shared their plan">
      <div className="pl-shared">
        <div className="pl-shared-figure">
          <div className="pl-card-label">Shared their plan</div>
          <div className="pl-fig tnum">
            {view.shared.length}<span className="pl-fig-of"> / {total}</span>
          </div>
          <div className="pl-card-sub">
            {view.waiting} decision{view.waiting === 1 ? '' : 's'} waiting
          </div>
        </div>
        <ul className="pl-people">
          {view.contractors.map((c) => (
            <li key={c.id} className="pl-person" data-contractor={c.id}>
              <span className={`pl-avatar ${c.shared ? '' : 'pl-avatar-empty'}`} aria-hidden="true">
                {initials(c.name)}
                {c.shared && (
                  <span className={`pl-avatar-mark ${c.done ? 'pl-mark-done' : 'pl-mark-pending'}`}>
                    {c.done ? <Check size={12} strokeWidth={3} /> : <Clock size={12} strokeWidth={2.5} />}
                  </span>
                )}
              </span>
              <span className="pl-person-name">{c.name}</span>
              <span className="pl-person-word">{c.word}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function InternalCard({ totals, internal }) {
  return (
    <Card className="pl-card" aria-label="Contractors vs Internal PIP">
      <div className="pl-card-head">
        <span className="pl-card-label">Contractors vs Internal PIP</span>
        <span className="pl-card-note">not shown to contractors</span>
      </div>
      <div className="pl-vs-grid">
      {STREAMS.map((stream) => (
        <div key={stream} className="pl-vs" data-stream={stream}>
          <div className="pl-vs-head">
            <b>{STREAM_TITLE[stream]}</b>
            {internal && internal[stream] != null && (
              <span className="tnum">{vsText(totals[stream], internal[stream])}</span>
            )}
          </div>
          {!internal ? (
            <span className="pl-card-note">Loading…</span>
          ) : internal[stream] == null ? (
            <span className="pl-card-note">No internal PIP set</span>
          ) : (
            <span className="pl-meter" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (100 * totals[stream]) / Math.max(1, internal[stream]))}%` }} />
            </span>
          )}
        </div>
      ))}
      </div>
    </Card>
  )
}

function vsText(total, internal) {
  const gap = internal - total
  const tail = gap > 0 ? ` · ${fmt(gap)} short` : gap < 0 ? ` · ${fmt(-gap)} above` : ''
  return `${fmt(total)} of ${fmt(internal)}${tail}`
}

// ------------------------------------------------------------------- B. lists
function NotSharedList({ contractors }) {
  return (
    <Card className="pl-card pl-notshared" aria-label="Not shared yet">
      <div className="pl-card-head">
        <span className="pl-card-label">Not shared yet</span>
        <span className="pl-count tnum">{contractors.length}</span>
      </div>
      {contractors.length === 0 ? (
        <span className="pl-card-note">Everyone has shared a plan.</span>
      ) : (
        <ul className="pl-plain">
          {contractors.map((c) => (
            <li key={c.id} className="pl-ns-row">
              <span className="pl-avatar pl-avatar-sm pl-avatar-empty" aria-hidden="true">{initials(c.name)}</span>
              <span>
                <span className="pl-name">{c.name}</span>
                <span className="pl-row-sub tnum">
                  Last month:{' '}
                  {STREAMS.map((s) => `${STREAM_SHORT[s]} ${fmt(c.cells[s].lastMonth)}`).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function SharedList({ contractors, runningMonthName, decision, onOpenHistory }) {
  return (
    <Card className="pl-card pl-shared-list" aria-label="Shared">
      <div className="pl-card-head">
        <span className="pl-card-label">Shared</span>
        <span className="pl-count tnum">{contractors.length}</span>
      </div>
      {contractors.length === 0 ? (
        <span className="pl-card-note">No plan has been shared for this month yet.</span>
      ) : (
        <div className="pl-grid" role="table" aria-label="Shared plans">
          <div className="pl-grid-row pl-grid-head" role="row">
            <span role="columnheader">Contractor</span>
            {STREAMS.map((s) => (
              <span key={s} role="columnheader">{STREAM_TITLE[s]}</span>
            ))}
          </div>
          {contractors.map((c) => (
            <div key={c.id} className="pl-grid-row" role="row" data-contractor={c.id}>
              <span className="pl-who" role="cell">
                <span className="pl-avatar pl-avatar-sm" aria-hidden="true">{initials(c.name)}</span>
                <span>
                  <button type="button" className="pl-name pl-name-link" onClick={() => onOpenHistory(c)}>
                    {c.name}
                  </button>
                  <span className="pl-row-sub">
                    {STREAMS.some((s) => c.cells[s].isLate) ? 'Shared late' : 'Shared'}
                  </span>
                </span>
              </span>
              {STREAMS.map((stream) => (
                <StreamCell
                  key={stream}
                  stream={stream}
                  cell={c.cells[stream]}
                  who={c.name}
                  runningMonthName={runningMonthName}
                  decision={decision}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function StreamCell({ stream, cell, who, runningMonthName, decision }) {
  const [returning, setReturning] = useState(false)
  if (cell.state === 'none') {
    return <span className="pl-cell pl-cell-none" role="cell" data-stream={stream}>—</span>
  }
  return (
    <span className="pl-cell" role="cell" data-stream={stream}>
      <span className="pl-cell-main">
        <span>
          <span className="pl-num tnum">{fmt(cell.number)}</span>
          <span className="pl-row-sub tnum">{fmt(cell.runningPip)} in {runningMonthName}</span>
          {cell.aboveHeld && <span className="pl-over tnum">Above {fmt(cell.held)} sites held</span>}
        </span>
        <Decision
          state={cell.state}
          label={`${STREAM_TITLE[stream]} for ${who}`}
          decision={decision}
          returning={returning}
          onReturn={() => setReturning(true)}
          onApprove={() => decision.decide(cell.planId, 'approve', null, who)}
        />
      </span>
      {returning && (
        <ReturnForm
          busy={decision.busy}
          onCancel={() => setReturning(false)}
          onSend={async (comment) => {
            if (await decision.decide(cell.planId, 'return', comment, who)) setReturning(false)
          }}
        />
      )}
    </span>
  )
}

/** The buttons for a plan waiting on the PM, or the plan's status in words. */
function Decision({ state, label, decision, returning, onReturn, onApprove }) {
  if (state === 'approved') {
    return <span className="pl-pill pl-pill-done"><Check size={13} strokeWidth={3} /> Approved</span>
  }
  if (state === 'returned') return <span className="pl-pill pl-pill-pending">Returned</span>
  if (!decision.canDecide) return <span className="pl-pill pl-pill-pending">Waiting</span>
  return (
    <span className="pl-actions">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={`Return ${label}`}
        disabled={decision.busy || returning}
        onClick={onReturn}
      >
        Return
      </button>
      <button type="button" className="btn btn-sm" aria-label={`Approve ${label}`} disabled={decision.busy} onClick={onApprove}>
        <Check size={14} /> Approve
      </button>
    </span>
  )
}

/** Return needs a comment: the server refuses one without, and so does this. */
function ReturnForm({ busy, onSend, onCancel }) {
  const id = useId()
  const [comment, setComment] = useState('')
  return (
    <span className="pl-return">
      <label className="pl-return-label" htmlFor={id}>What should they change?</label>
      <textarea
        id={id}
        className="input"
        rows={2}
        maxLength={1000}
        disabled={busy}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <span className="pl-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !comment.trim()} onClick={() => onSend(comment)}>
          Send
        </button>
      </span>
    </span>
  )
}

// --------------------------------------------------------------- C. revisions
function RevisionCard({ revision: r, runningMonthName, decision }) {
  const [returning, setReturning] = useState(false)
  const title = `Revision for ${runningMonthName} · ${r.name} · ${STREAM_SHORT[r.stream]} ${fmt(r.from)} → ${fmt(r.to)}`
  const reason = REASON_LABEL[r.reason] || r.reason
  return (
    <section className="pl-revision" aria-label={title} data-plan={r.planId}>
      <span className="ui-card-chip" aria-hidden="true"><PencilLine size={18} /></span>
      <span className="pl-revision-body">
        {/* <bdi> keeps each Farsi name in its own run, so the bidi algorithm
            does not reorder it with the English around it. */}
        <span className="pl-revision-title tnum">
          Revision for <bdi>{runningMonthName}</bdi> · <bdi>{r.name}</bdi> · {STREAM_SHORT[r.stream]} {fmt(r.from)} → {fmt(r.to)}
        </span>
        <span className="pl-revision-note">
          {reason && <>{reason}{r.comment && <> — <bdi>{r.comment}</bdi></>} · </>}
          until you decide, {fmt(r.from)} counts
        </span>
        {returning && (
          <ReturnForm
            busy={decision.busy}
            onCancel={() => setReturning(false)}
            onSend={async (comment) => {
              if (await decision.decide(r.planId, 'return', comment, r.name)) setReturning(false)
            }}
          />
        )}
      </span>
      <Decision
        state="waiting"
        label={`the ${STREAM_SHORT[r.stream]} revision for ${r.name}`}
        decision={decision}
        returning={returning}
        onReturn={() => setReturning(true)}
        onApprove={() => decision.decide(r.planId, 'approve', null, r.name)}
      />
    </section>
  )
}
