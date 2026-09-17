import { ChevronDown, ChevronRight, Landmark, ShieldCheck } from 'lucide-react'
import LetterRef from '../../components/LetterRef'
import { EvidenceLink, ReviewBody, SubmitBody, VerdictRows } from './SubmissionForm'
import { AUTHORITY_LABEL, AUTHORITY_PILL, AUTHORITY_WHERE } from './status'

const ICONS = { ICT: ShieldCheck, CRA: Landmark }

function shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * One authority, whole: its standing in the header and its own form inside.
 *
 * The two blocks are stacked rather than side by side with a single form
 * underneath, because the question "which authority am I filing?" was being
 * answered by a segmented control next to a heading that most of the time was
 * not rendered at all. A block per authority, each with its own submit button,
 * makes the answer the thing you are already looking at.
 *
 * One submit per block, one authority per call: the submissions endpoint takes
 * one authority and is all-or-nothing per call, so a combined "file both"
 * would be two transactions and could leave ICT filed and CRA not.
 */
export default function AuthorityBlock({
  village, authority, status, rounds, mode, expanded, onToggle,
  onDone, onError, onRefresh,
}) {
  const Icon = ICONS[authority]
  const latest = rounds[0]
  const live = rounds.find((s) => s.review_status === 'Pending')
  const decided = rounds.filter((s) => s.review_status !== 'Pending')
  const previous = decided[0]
  const returned = latest?.review_status === 'Returned' ? latest : null

  // What this block is for right now. A reviewer acts on a pending round; a
  // submitter acts on an authority the server still accepts a letter for.
  const actionable =
    mode === 'review' ? Boolean(live) : village.can_submit.includes(authority)

  const heading =
    mode === 'review'
      ? `Validating ${authority}`
      : previous
        ? `Resubmitting ${authority}`
        : `Filing ${authority}`
  const round = mode === 'review' ? live?.round_no : (previous?.round_no || 0) + 1

  return (
    <div className={`auth-block is-${authority.toLowerCase()} ${expanded ? 'is-open' : ''}`}>
      <button
        type="button"
        className="auth-block-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Icon size={15} />
        <span className="who">
          <span className="role">{authority}</span>
          <span className="where">{AUTHORITY_WHERE[authority]}</span>
        </span>
        <span className="spacer" />
        <span className={`pill ${AUTHORITY_PILL[status] || 'pill-dim'}`}>
          {AUTHORITY_LABEL[status] || status}
        </span>
        {latest && (
          <span className="letter">
            <LetterRef value={latest.letter_number} />
            {' · round '}
            {latest.round_no}
          </span>
        )}
      </button>

      {expanded && (
        <div className="auth-block-body">
          {/* The reason a round came back sits inside the block whose fields
              answer it, not in a shared panel above both. */}
          {returned && (
            <div className="card-pad" style={{ paddingBottom: 0 }}>
              <div className="reason">
                <strong>Returned by {returned.reviewed_by_name || 'a reviewer'}</strong>
                {returned.reviewed_at ? ` on ${shortDate(returned.reviewed_at)}` : ''}.{' '}
                {returned.review_comment}
              </div>
            </div>
          )}

          {actionable && (
            <div className="auth-block-title">
              <h3>
                {heading}
                {' · '}
                <span className="muted" style={{ fontWeight: 400 }}>Round {round}</span>
              </h3>
            </div>
          )}

          {actionable ? (
            mode === 'review' ? (
              <ReviewBody
                submission={live}
                authority={authority}
                onDone={onDone}
                onError={onError}
              />
            ) : (
              <SubmitBody
                village={village}
                authority={authority}
                previous={previous}
                onDone={onDone}
                onError={onError}
                onRefresh={onRefresh}
              />
            )
          ) : (
            <Record authority={authority} submission={latest} onError={onError} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A block nobody can act on, opened anyway.
 *
 * This is how someone checks which letter number was accepted, so it shows the
 * round as it stands and nothing that could be mistaken for a form.
 */
function Record({ authority, submission, onError }) {
  if (!submission) {
    return (
      <div className="card-pad dim" style={{ fontSize: 12.5 }}>
        No {authority} letter filed yet.
      </div>
    )
  }

  return (
    <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13 }}>
        Letter <LetterRef value={submission.letter_number} />
        {submission.letter_date_shamsi ? (
          <>
            {' · '}
            <LetterRef value={submission.letter_date_shamsi} />
          </>
        ) : null}
        {' · round '}
        {submission.round_no}
        {submission.submitted_by_name ? ` · ${submission.submitted_by_name}` : ''}
      </div>

      <VerdictRows
        claims={submission.technologies.map((t) => ({
          technology: t.technology,
          claimed_status: t.claimed_status,
          comment: t.comment,
        }))}
        onChange={() => {}}
        authority={authority}
        readOnly
      />

      {submission.evidence.length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          {submission.evidence.map((e) => (
            <EvidenceLink key={e.id} evidence={e} onError={onError} />
          ))}
        </div>
      )}
    </div>
  )
}
