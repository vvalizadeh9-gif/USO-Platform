import { useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useToast } from '../../context/ToastContext'
import { shamsiDayLabel } from '../../lib/shamsi'
import { Avatar, PlanBar, PlanStatus, TabState } from './parts'
import { buildApprovals } from './planBoard'
import ReturnDialog from './ReturnDialog'
import { REASON_LABEL, streamMeta } from './streams'

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

/**
 * Approvals: every plan waiting on the PM, on one page.
 *
 * One card per contractor with plans waiting for the planning month, then one
 * per contractor with a revision request pending on the running month. Each
 * card's Approve decides every waiting plan on it (one POST per plan, in
 * parallel); Return sends them all back with one required comment. A role
 * that cannot decide reads the same cards without the buttons. The server
 * re-checks every decision.
 *
 * There is no Undo: the API has no way to reverse an approval.
 */
export default function ApprovalsTab({ board, running, canDecide, onDecided, announce }) {
  const toast = useToast()
  const gridRef = useRef(null)
  const focusGrid = useRef(false)
  const [busy, setBusy] = useState(null)
  const [gone, setGone] = useState(() => new Set())
  const [returning, setReturning] = useState(null)
  const [returnError, setReturnError] = useState('')

  // New figures from the server replace the cards hidden while they came.
  useEffect(() => setGone(new Set()), [board.planning, board.running])

  // After a decision, focus goes to the grid rather than to a card that left.
  useEffect(() => {
    if (focusGrid.current) {
      focusGrid.current = false
      gridRef.current?.focus()
    }
  })

  if (board.state !== 'ready') {
    return <TabState state={board.state} what="Plans" onRetry={board.reload} />
  }

  const { cards, decided } = buildApprovals(board, running)
  const shown = cards.filter((c) => !gone.has(c.key))

  async function decideAll(card, action, comment) {
    setBusy(card.key)
    const results = await Promise.allSettled(
      card.blocks.map((b) =>
        action === 'approve'
          ? api.post(`/pip/${b.planId}/approve`)
          : api.post(`/pip/${b.planId}/return`, { comment }),
      ),
    )
    setBusy(null)
    const failed = card.blocks.filter((_, i) => results[i].status === 'rejected')
    const verb = action === 'approve' ? 'Approved' : 'Sent back to'
    if (failed.length === 0) {
      // A Return moves focus once its dialog has closed (below).
      if (action === 'approve') focusGrid.current = true
      setGone((g) => new Set(g).add(card.key))
      toast.success(`${verb} ${card.name}`)
      announce(`${verb} ${card.name}`)
    } else {
      const which = failed.map((b) => streamMeta(b.stream).title).join(', ')
      const detail = results.find((r) => r.status === 'rejected')?.reason?.response?.data?.detail
      const message = `Could not ${action === 'approve' ? 'approve' : 'send back'} ${which} for ${card.name}.`
      toast.error(message, detail || 'Please try again.')
      announce(message)
    }
    onDecided()
    return failed
  }

  async function sendBack(comment) {
    setReturnError('')
    const failed = await decideAll(returning, 'return', comment)
    if (failed.length === 0) {
      focusGrid.current = true
      setReturning(null)
    } else {
      // Only what is still waiting goes on a second try.
      setReturning({ ...returning, blocks: failed })
      setReturnError(`Not sent back: ${failed.map((b) => streamMeta(b.stream).title).join(', ')}. Try again.`)
    }
  }

  return (
    <div className="mp-approvals">
      <section
        ref={gridRef}
        className="mp-grid-wrap"
        tabIndex={-1}
        aria-label={canDecide ? 'Waiting for approval' : 'Waiting'}
      >
        {!canDecide && shown.length > 0 && <h2 className="mp-section-label">Waiting</h2>}
        {shown.length === 0 ? (
          <div className="mp-empty">
            <span className="mp-empty-mark" aria-hidden="true"><Icon name="checkmark" size={20} /></span>
            <p>All plans decided</p>
          </div>
        ) : (
          <ul className="mp-grid" aria-label="Contractors waiting">
            {shown.map((card) => (
              <ApprovalCard
                key={card.key}
                card={card}
                canDecide={canDecide}
                busy={busy === card.key}
                disabled={busy != null}
                onApprove={() => decideAll(card, 'approve')}
                onReturn={() => {
                  setReturnError('')
                  setReturning(card)
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="mp-decided" aria-labelledby="mp-decided-label">
          <h2 className="mp-section-label" id="mp-decided-label">Decided</h2>
          <ul>
            {decided.map((c) => (
              <li key={c.id}>
                <Avatar name={c.name} size="sm" />
                <bdi className="mp-fa">{c.name}</bdi>
                <PlanStatus state={c.state} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {returning && (
        <ReturnDialog
          name={returning.name}
          busy={busy === returning.key}
          error={returnError}
          onSend={sendBack}
          onCancel={() => setReturning(null)}
        />
      )}
    </div>
  )
}

function ApprovalCard({ card, canDecide, busy, disabled, onApprove, onReturn }) {
  const submitted = shamsiDayLabel(card.submittedAt)
  const titleId = `mp-card-${card.key}`
  return (
    <li className="mp-card" aria-labelledby={titleId} data-card={card.key}>
      <header className="mp-card-head">
        <Avatar name={card.name} />
        <div className="mp-card-who">
          <h3 id={titleId} className="mp-fa">{card.name}</h3>
          <p className="mp-meta">
            {card.kind === 'revision' && <span className="mp-tag">Revision request</span>}
            {submitted && (
              <>
                Submitted <span className="mp-fa">{submitted}</span>
              </>
            )}
          </p>
        </div>
      </header>

      <div className="mp-blocks" style={{ '--mp-cols': card.blocks.length }}>
        {card.blocks.map((b) => (
          <Block key={b.stream} block={b} revision={card.kind === 'revision'} />
        ))}
      </div>

      {canDecide && (
        <footer className="mp-card-foot">
          <button
            type="button"
            className="mp-btn"
            aria-label={`Return ${card.name}`}
            disabled={disabled}
            onClick={onReturn}
          >
            Return
          </button>
          <button
            type="button"
            className="mp-btn mp-btn-primary"
            aria-label={`Approve ${card.name}`}
            disabled={disabled}
            onClick={onApprove}
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </footer>
      )}
    </li>
  )
}

function Block({ block: b, revision }) {
  const title = streamMeta(b.stream).title
  const compareWord = revision ? 'In force' : 'Last month'
  return (
    <div className="mp-block" data-stream={b.stream}>
      <div className="mp-block-name">{title}</div>
      <div className="mp-block-number tnum">{fmt(b.number)}</div>
      <PlanBar
        value={b.number}
        tick={b.compare}
        label={`${title}: ${revision ? 'requested' : 'plan'} ${fmt(b.number)}, ${compareWord.toLowerCase()} ${fmt(b.compare)}`}
      />
      <div className="mp-meta tnum">{compareWord} {fmt(b.compare)}</div>
      {revision && b.reason && <div className="mp-meta">{REASON_LABEL[b.reason] || b.reason}</div>}
      {b.above != null && <div className="mp-alert tnum">Plan is {b.above} above sites held</div>}
      {b.behind != null && <div className="mp-alert tnum">{b.behind} behind</div>}
    </div>
  )
}
