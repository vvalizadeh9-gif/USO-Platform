import { AuthorityChip, Banner } from '../../components/ui'
import FilingForm from './FilingForm'
import ManyFilingForm from './ManyFilingForm'
import ReviewBlock from './ReviewBlock'
import RoundHistory from './RoundHistory'
import { StatusBar } from './StatusBar'
import { lastReasonText, shown } from './roundText'
import { sideErrors } from './useLetterActions'

const EDITABLE = new Set(['waiting', 'returned', 'rejected'])

function singleTitle(side, status, held) {
  if (status === 'approved') return 'Done'
  if (status === 'filled') return side.reviewable && !held ? `To check · round ${side.round_no}` : 'In review'
  return `Round ${side.next_round_no || (side.round_no || 0) + 1}`
}

/** The note above the form: where a side stands when there is nothing to fill. */
function topNote(status, history, reviewable) {
  if (status === 'approved') {
    const round = history.find((r) => r.result === 'approved')
    if (!round) return null
    return { tone: 'success', label: 'Approved', codes: [round.letter_number, round.letter_date_shamsi] }
  }
  if (status === 'filled' && !reviewable && history[0]) {
    return { tone: 'ongoing', label: 'With coordinator', codes: [history[0].letter_number] }
  }
  return null
}

/** A status note; letter numbers and dates are isolated so a Persian
 * letter inside one cannot reorder the sentence around it. */
function Note({ note }) {
  if (!note) return null
  return (
    <div className="mw-note" data-tone={note.tone}>
      {note.label}
      {note.codes.filter(Boolean).map((code) => (
        <span key={code}> · <span className="mw-fa-ltr">{shown(code)}</span></span>
      ))}
    </div>
  )
}

/** One authority, one village: status, the thing to do, the history. */
export function SingleAuthorityCard({
  authority, view, decides, detail, side, held, form, actions, letters, sendLabel,
}) {
  const status = held?.status || side.status
  const history = held?.round ? [held.round, ...side.history] : side.history
  const editable = side.editable && !held && EDITABLE.has(status)
  const reviewing = side.reviewable && !held && status === 'filled'
  const pending = side.history.find((r) => r.result === 'pending')
  const errors = sideErrors(form, { villageId: detail.village_id, toFile: side.to_file })
  const row = { village_id: detail.village_id, village_name: detail.facts.village_name }

  return (
    <article className="ui-card mw-auth-card" aria-label={authority}>
      <div className="mw-auth-head">
        <AuthorityChip authority={authority} />
        <h3 className="mw-auth-title">{singleTitle(side, status, held)}</h3>
      </div>
      <StatusBar status={status} view={view} />
      {!editable && <Note note={topNote(status, history, reviewing)} />}
      {errors.message && <Banner tone="error">{errors.message}</Banner>}
      <div className="mw-auth-body">
        {reviewing && pending && (
          <ReviewBlock
            round={pending}
            contractor={detail.contractor_name}
            sameLetter={side.same_letter}
            onConfirm={() => letters.confirm(authority, row, pending)}
            onConfirmAll={() => letters.confirmAll(authority, row, pending, side.same_letter.count)}
            onReturn={(reason) => letters.giveBack(authority, row, pending, reason)}
          />
        )}
        {editable && (
          <FilingForm
            authority={authority}
            requested={detail.facts.requested_technologies}
            side={side}
            villageId={detail.village_id}
            form={form}
            errors={errors}
            actions={actions}
            sendLabel={sendLabel}
            decides={decides}
            onAttach={letters.attachScan}
            onSend={() => letters.sendOne(authority, row, side)}
          />
        )}
      </div>
      <RoundHistory rounds={history} />
      {editable && side.last_reason && (
        <div className="mw-note" data-tone="danger">{lastReasonText(side.last_reason)}</div>
      )}
    </article>
  )
}

/** One authority, many villages: one letter for every village that can take it. */
export function ManyAuthorityCard({
  authority, decides, readOnly, rows, heldFor, form, actions, letters, sendLabel,
}) {
  const fileable = rows.filter((row) => row.sides[authority].editable && !heldFor(row.village_id))
  const skipped = rows.filter((row) => !fileable.includes(row))
  const errors = sideErrors(form)
  return (
    <article className="ui-card mw-auth-card" aria-label={authority}>
      <div className="mw-auth-head">
        <AuthorityChip authority={authority} />
        <h3 className="mw-auth-title">{fileable.length} of {rows.length} villages</h3>
      </div>
      {errors.message && <Banner tone="error">{errors.message}</Banner>}
      {fileable.length === 0 || readOnly ? (
        <div className="mw-note" data-tone="neutral">Nothing to send</div>
      ) : (
        <div className="mw-auth-body">
          <ManyFilingForm
            authority={authority}
            fileable={fileable}
            skipped={skipped}
            form={form}
            errors={errors}
            actions={actions}
            sendLabel={`${sendLabel} · ${fileable.length}`}
            decides={decides}
            onAttach={letters.attachScan}
            onSend={() => letters.sendMany(authority, fileable)}
          />
        </div>
      )}
    </article>
  )
}
