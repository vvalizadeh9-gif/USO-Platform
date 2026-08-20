import { useEffect, useRef, useState } from 'react'
import {
  ShieldCheck, Landmark, Paperclip, Trash2, Download,
  CheckCircle2, CornerUpLeft, ChevronDown,
} from 'lucide-react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { StatusPill } from '../../components/ui'
import ShamsiDate from './ShamsiDate'
import LetterRef from './LetterRef'

const META = {
  ICT: { icon: ShieldCheck, where: 'province office' },
  CRA: { icon: Landmark, where: 'region office' },
}

function shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const detail = (err, fallback) => err?.response?.data?.detail || fallback

/**
 * One authority's whole story for one village: where it stands, whatever is
 * in flight, and the form to move it on.
 *
 * ICT and CRA are independent, so each gets its own panel and its own letter.
 * They are never merged into a single form — one letter belongs to one
 * authority, and blurring that would cost the record its defensibility.
 */
export default function AuthorityPanel({
  authority, village, submissions, canReview, currentUserName, onChanged,
}) {
  const { icon: Icon, where } = META[authority]
  const rounds = submissions.filter((s) => s.authority === authority)
  const live = rounds.find((s) => s.review_status === 'Pending')
  const latest = rounds[0]
  const returned = !live && latest?.review_status === 'Returned' ? latest : null

  const verdict = authority === 'ICT' ? village.ict_verdict : village.cra_verdict
  const settled = verdict === 'Approved'
  const mayFile = village.can_submit.includes(authority)

  const [filing, setFiling] = useState(false)

  // A returned submission is the one thing the submitter must act on, so the
  // form opens by itself rather than hiding behind another click.
  useEffect(() => { setFiling(Boolean(returned) && mayFile) }, [returned, mayFile])

  return (
    <section className="auth-panel">
      <div className="auth-head">
        <Icon size={15} className={authority === 'ICT' ? 'ict-ink' : 'cra-ink'} />
        <div>
          <div className="auth-name">{authority}</div>
          <div className="auth-where">{where}</div>
        </div>
        <div className="spacer" />
        <StatusPill status={verdict} />
      </div>

      <div className="auth-body">
        {live && (
          <InFlight
            submission={live}
            canReview={canReview}
            mine={live.submitted_by_name === currentUserName}
            onChanged={onChanged}
          />
        )}

        {returned && (
          <div className="reason">
            <strong>Returned by {returned.reviewed_by_name || 'a reviewer'}.</strong>{' '}
            {returned.review_comment}
          </div>
        )}

        {!live && filing && (
          <FileLetter
            authority={authority}
            villageId={village.village_id}
            technologies={village.requested_technologies}
            nextRound={(latest?.round_no || 0) + 1}
            onCancel={() => setFiling(false)}
            onDone={() => { setFiling(false); onChanged() }}
          />
        )}

        {!live && !filing && (
          settled ? (
            <div className="auth-empty">
              Approved for every requested technology. Nothing to do here.
            </div>
          ) : mayFile ? (
            <>
              {rounds.length === 0 && (
                <div className="auth-empty" style={{ padding: '6px 0' }}>
                  No {authority} letter filed yet.
                </div>
              )}
              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setFiling(true)}
              >
                File {authority} letter{rounds.length > 0 ? ` — round ${rounds.length + 1}` : ''}
              </button>
            </>
          ) : (
            <div className="auth-empty">Nothing to file. Waiting on someone else.</div>
          )
        )}

        <History rounds={rounds} skipId={live?.id} />
      </div>
    </section>
  )
}

/* ------------------------------------------------- a submission in review --- */

function InFlight({ submission: s, canReview, mine, onChanged }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')

  async function act(fn, done) {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      onChanged()
    } catch (err) {
      toast.error(detail(err, 'That did not go through'))
    } finally {
      setBusy(false)
      setReturning(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="pill pill-amber">Round {s.round_no} · waiting review</span>
      </div>

      <ClaimSummary submission={s} />

      {canReview ? (
        returning ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="input" autoFocus placeholder="What must the submitter correct?"
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm btn-primary" disabled={busy || !reason.trim()}
                onClick={() => act(
                  () => api.post(`/acceptance/submissions/${s.id}/review`, { decision: 'Returned', comment: reason }),
                  'Sent back to the submitter',
                )}
              >
                Return it
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setReturning(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm btn-primary" disabled={busy}
              onClick={() => act(
                () => api.post(`/acceptance/submissions/${s.id}/review`, { decision: 'Validated' }),
                'Recorded',
              )}
            >
              <span className="row" style={{ gap: 5 }}><CheckCircle2 size={13} /> Validate</span>
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setReturning(true)}>
              <span className="row" style={{ gap: 5 }}><CornerUpLeft size={13} /> Return</span>
            </button>
          </div>
        )
      ) : mine ? (
        <button
          className="link-btn" disabled={busy} style={{ alignSelf: 'flex-start' }}
          onClick={() => act(
            () => api.post(`/acceptance/submissions/${s.id}/withdraw`),
            'Withdrawn',
          )}
        >
          Withdraw this submission
        </button>
      ) : (
        <div className="dim" style={{ fontSize: 12.5 }}>Waiting for a coordinator to review it.</div>
      )}
    </div>
  )
}

/* ----------------------------------------------------- shared read-only --- */

function ClaimSummary({ submission: s }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row wrap" style={{ gap: 5 }}>
        {s.technologies.map((t) => (
          <span
            key={t.technology}
            className={`pill ${t.claimed_status === 'Approved' ? 'pill-green' : 'pill-red'}`}
          >
            {t.technology}
          </span>
        ))}
      </div>

      <div className="dim" style={{ fontSize: 12.5 }}>
        Letter <LetterRef value={s.letter_number} />
        {s.letter_date_shamsi ? <> · <LetterRef value={s.letter_date_shamsi} /></> : null}
        {' · '}{s.submitted_by_name || 'unknown'} on {shortDate(s.submitted_at)}
      </div>

      {s.technologies.filter((t) => t.comment).map((t) => (
        <div key={t.technology} className="dim" style={{ fontSize: 12.5 }}>
          <strong>{t.technology}:</strong> {t.comment}
        </div>
      ))}

      {s.evidence.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {s.evidence.map((e) => <EvidenceLink key={e.id} evidence={e} />)}
        </div>
      )}
    </div>
  )
}

function EvidenceLink({ evidence }) {
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        // The endpoint needs the bearer token, which a plain link cannot send.
        const r = await api.get(`/acceptance/evidence/${evidence.id}/download`, { responseType: 'blob' })
        const url = URL.createObjectURL(r.data)
        const a = document.createElement('a')
        a.href = url
        a.download = evidence.original_filename
        a.click()
        URL.revokeObjectURL(url)
      }}
    >
      <span className="row" style={{ gap: 5 }}>
        <Download size={12} /> {evidence.original_filename}
      </span>
    </button>
  )
}

/* --------------------------------------------------------- filing a letter --- */

function FileLetter({ authority, villageId, technologies, nextRound, onCancel, onDone }) {
  const toast = useToast()
  const fileInput = useRef(null)
  const [claims, setClaims] = useState(() =>
    technologies.map((t) => ({ technology: t, claimed_status: 'Approved', comment: '' }))
  )
  const [letterNumber, setLetterNumber] = useState('')
  const [letterDate, setLetterDate] = useState('')
  const [files, setFiles] = useState([])
  const [limits, setLimits] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/acceptance/limits').then((r) => setLimits(r.data)).catch(() => {})
  }, [])

  const set = (technology, patch) =>
    setClaims((cur) => cur.map((c) => (c.technology === technology ? { ...c, ...patch } : c)))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post(`/acceptance/villages/${villageId}/submissions`, {
        authority,
        letter_number: letterNumber,
        letter_date_shamsi: letterDate || null,
        technologies: claims.map((c) => ({
          technology: c.technology,
          claimed_status: c.claimed_status,
          comment: c.comment || null,
        })),
      })
      // Evidence is attached after the submission exists, so a failed upload
      // never loses the verdicts just typed.
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/acceptance/submissions/${data.id}/evidence`, form)
      }
      toast.success(`${authority} letter sent for review`)
      onDone()
    } catch (err) {
      setError(detail(err, 'Could not send it. Check the form and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {nextRound > 1 && (
        <div className="dim" style={{ fontSize: 12 }}>Round {nextRound}</div>
      )}
      {error && <div className="form-banner form-banner-error">{error}</div>}

      {claims.map((claim) => (
        <div key={claim.technology}>
          <div className="tech-row">
            <span className="tech-name">{claim.technology}</span>
            <div className="choice">
              <button
                type="button" className="is-yes"
                aria-pressed={claim.claimed_status === 'Approved'}
                onClick={() => set(claim.technology, { claimed_status: 'Approved' })}
              >
                Approved
              </button>
              <button
                type="button" className="is-no"
                aria-pressed={claim.claimed_status === 'Rejected'}
                onClick={() => set(claim.technology, { claimed_status: 'Rejected' })}
              >
                Rejected
              </button>
            </div>
          </div>
          {claim.claimed_status === 'Rejected' && (
            <input
              className="input" required maxLength={1000} style={{ marginTop: 6 }}
              placeholder={`Why did ${authority} reject ${claim.technology}?`}
              value={claim.comment}
              onChange={(e) => set(claim.technology, { comment: e.target.value })}
            />
          )}
        </div>
      ))}

      <label className="field">
        <span>Letter number</span>
        {/* Same reasoning as LetterRef: a letter number is a code, so its
            characters must appear in the order they were typed rather than be
            reordered around the Arabic letter most of them contain. */}
        <input
          className="input" value={letterNumber} required maxLength={120}
          placeholder="1404/ص/4471"
          dir="ltr" style={{ unicodeBidi: 'isolate-override' }}
          onChange={(e) => setLetterNumber(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Letter date</span>
        <ShamsiDate value={letterDate} onChange={setLetterDate} disabled={busy} />
      </label>

      <div>
        <input
          ref={fileInput} type="file" multiple hidden
          accept={limits ? limits.accepted_extensions.map((x) => `.${x}`).join(',') : undefined}
          onChange={(e) => {
            setFiles((cur) => [...cur, ...Array.from(e.target.files || [])])
            e.target.value = ''
          }}
        />
        <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
          <span className="row" style={{ gap: 6 }}><Paperclip size={13} /> Attach the scan</span>
        </button>
        {limits && (
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            {limits.accepted_extensions.join(', ').toUpperCase()} · up to {limits.max_file_mb} MB each
          </div>
        )}
        {files.map((file, i) => (
          <div key={`${file.name}-${i}`} className="row" style={{ gap: 8, fontSize: 12.5, marginTop: 6 }}>
            <Paperclip size={12} className="dim" />
            <span>{file.name}</span>
            <div className="spacer" />
            <button
              type="button" className="btn btn-sm btn-ghost"
              onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send for review'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ history --- */

function History({ rounds, skipId }) {
  const past = rounds.filter((s) => s.id !== skipId)
  const [open, setOpen] = useState(false)
  if (past.length === 0) return null

  // The latest decided round is worth seeing without asking; the ones before
  // it are the argument you only open when there is an argument.
  const [head, ...older] = past

  return (
    <div>
      <div className="round-line">
        <span>Round {head.round_no}</span>
        <StatusPill status={head.review_status} />
        <div className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          {head.reviewed_by_name || head.submitted_by_name} · {shortDate(head.reviewed_at || head.submitted_at)}
        </span>
      </div>
      <ClaimSummary submission={head} />

      {older.length > 0 && (
        <>
          <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setOpen(!open)}>
            <span className="row" style={{ gap: 4 }}>
              <ChevronDown
                size={13}
                style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
              />
              {open ? 'Hide' : `${older.length} earlier round${older.length > 1 ? 's' : ''}`}
            </span>
          </button>
          {open && older.map((s) => (
            <div key={s.id} style={{ marginTop: 10 }}>
              <div className="round-line">
                <span>Round {s.round_no}</span>
                <StatusPill status={s.review_status} />
                <div className="spacer" />
                <span className="dim" style={{ fontSize: 12 }}>
                  {shortDate(s.reviewed_at || s.submitted_at)}
                </span>
              </div>
              {s.review_comment && <div className="reason">{s.review_comment}</div>}
              <ClaimSummary submission={s} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
