import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, CheckCircle2, CornerUpLeft, Download, FileText,
  RotateCcw, Trash2, Upload, X,
} from 'lucide-react'
import api from '../../api/client'
import LetterRef from '../../components/LetterRef'
import ShamsiDate from '../../components/ShamsiDate'
import { AUTHORITY_WHERE } from './status'

/**
 * The two halves of an acceptance round, and the pieces they share.
 *
 * `SubmitBody` files a letter; `ReviewBody` reads the same letter back and
 * approves it or returns it with a reason. They are the same object seen from
 * two sides, and a coordinator does both jobs in the same afternoon, so they
 * live together and render inside the same block (see AuthorityBlock).
 */

// The reasons a submission actually comes back, from the coordinators who send
// them back. Free text stays available underneath — these are a shortcut, not
// a closed list, and the reason is what the contractor has to act on.
const RETURN_REASONS = [
  'Wrong letter number',
  'Illegible scan',
  'Tech missing from letter',
  'Date mismatch',
  'Wrong village',
]

const draftKey = (villageId, authority) => `uep_acc_draft_${villageId}_${authority}`

/* ------------------------------------------------------------------ pieces */

/** Letter number and Shamsi date, side by side. Shared with the bulk modal. */
export function LetterFields({ number, onNumber, date, onDate, disabled }) {
  return (
    <div
      className="grid field-pair"
      style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}
    >
      <label className="field" style={{ marginBottom: 0 }}>
        <span>Letter number</span>
        {/* A letter number is an opaque code, not prose. Pinning the direction
            keeps "1404/ص/4471" in the order it was typed — see LetterRef. */}
        <input
          className="input"
          value={number}
          maxLength={120}
          required
          disabled={disabled}
          placeholder="1404/ص/4471"
          dir="ltr"
          style={{ unicodeBidi: 'isolate-override' }}
          onChange={(e) => onNumber(e.target.value)}
        />
      </label>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Letter date (Shamsi)</label>
        <ShamsiDate value={date} onChange={onDate} disabled={disabled} />
      </div>
    </div>
  )
}

/**
 * One row per requested technology, two tiles each.
 *
 * Only the technologies CPM requested appear, and the server refuses any
 * other — a 3G/4G site never shows a 2G box.
 */
export function VerdictRows({ claims, onChange, authority, readOnly }) {
  return (
    <div>
      {claims.map((claim) => (
        <div key={claim.technology}>
          <div className="verdict-row">
            <span className="tech">{claim.technology}</span>
            <div className="tiles">
              <button
                type="button"
                className="tile is-yes"
                aria-pressed={claim.claimed_status === 'Approved'}
                disabled={readOnly}
                onClick={() => onChange(claim.technology, { claimed_status: 'Approved' })}
              >
                <Check size={13} /> Approved
              </button>
              <button
                type="button"
                className="tile is-no"
                aria-pressed={claim.claimed_status === 'Rejected'}
                disabled={readOnly}
                onClick={() => onChange(claim.technology, { claimed_status: 'Rejected' })}
              >
                <X size={13} /> Reject
              </button>
            </div>
          </div>
          {claim.claimed_status === 'Rejected' &&
            (readOnly ? (
              claim.comment && (
                <div className="reason" style={{ marginBottom: 8 }}>{claim.comment}</div>
              )
            ) : (
              <input
                className="input"
                required
                maxLength={1000}
                style={{ marginBottom: 8 }}
                placeholder={`Why did ${authority} reject ${claim.technology}?`}
                value={claim.comment || ''}
                onChange={(e) => onChange(claim.technology, { comment: e.target.value })}
              />
            ))}
        </div>
      ))}
    </div>
  )
}

/** The scan. One file: a letter is one document, however many villages it covers. */
export function EvidenceBox({ file, onFile, limits, disabled }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)

  if (file) {
    return (
      <div className="surface-soft file-card">
        <div className="icon"><FileText size={18} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13.5 }}>{file.name}</div>
          <div className="meta">
            {(file.size / 1024).toFixed(0)} KB · {file.type || 'document'}
          </div>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled}
          onClick={() => onFile(null)}
        >
          <Trash2 size={13} /> Replace
        </button>
      </div>
    )
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={limits ? limits.accepted_extensions.map((x) => `.${x}`).join(',') : undefined}
        onChange={(e) => {
          onFile(e.target.files?.[0] || null)
          e.target.value = ''
        }}
      />
      <div
        className={`dropzone ${over ? 'is-over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFile(e.dataTransfer.files?.[0] || null)
        }}
      >
        <Upload size={20} style={{ opacity: 0.6 }} />
        <div style={{ marginTop: 6 }}>Drop the scanned letter here, or click to choose</div>
        {limits && (
          <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>
            {limits.accepted_extensions.join(', ').toUpperCase()} · up to {limits.max_file_mb} MB
          </div>
        )}
      </div>
    </>
  )
}

export function useUploadLimits() {
  const [limits, setLimits] = useState(null)
  useEffect(() => {
    api.get('/acceptance/limits').then((r) => setLimits(r.data)).catch(() => {})
  }, [])
  return limits
}

/* ------------------------------------------------------------ submitting */

export function SubmitBody({ village, authority, previous, onDone, onError, onRefresh }) {
  const limits = useUploadLimits()
  const storageKey = draftKey(village.village_id, authority)

  const blank = useMemo(
    () =>
      village.requested_technologies.map((t) => ({
        technology: t,
        claimed_status: 'Approved',
        comment: '',
      })),
    [village.requested_technologies]
  )

  const [claims, setClaims] = useState(blank)
  const [number, setNumber] = useState('')
  const [date, setDate] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // A draft is local to this browser: the server has no notion of an unsent
  // submission, and inventing one would put an unvalidated claim in the record
  // that the workflow says must not exist. This is a scratchpad, and it says
  // so.
  useEffect(() => {
    setClaims(blank)
    setNumber('')
    setDate('')
    setFile(null)
    setSaved(false)
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (stored) {
        setNumber(stored.number || '')
        setDate(stored.date || '')
        if (Array.isArray(stored.claims) && stored.claims.length === blank.length) {
          setClaims(stored.claims)
        }
        setSaved(true)
      }
    } catch {
      /* a corrupt draft is not worth a broken screen */
    }
  }, [storageKey, blank])

  const set = (technology, patch) =>
    setClaims((cur) => cur.map((c) => (c.technology === technology ? { ...c, ...patch } : c)))

  function copyPrevious() {
    if (!previous) return
    setNumber(previous.letter_number || '')
    setDate(previous.letter_date_shamsi || '')
    setClaims(
      blank.map((c) => {
        const was = previous.technologies.find((t) => t.technology === c.technology)
        return was
          ? { ...c, claimed_status: was.claimed_status, comment: was.comment || '' }
          : c
      })
    )
  }

  function saveDraft() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ number, date, claims }))
      setSaved(true)
    } catch {
      onError(null, 'This browser would not store the draft')
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const { data } = await api.post(
        `/acceptance/villages/${village.village_id}/submissions`,
        {
          authority,
          letter_number: number,
          letter_date_shamsi: date || null,
          technologies: claims.map((c) => ({
            technology: c.technology,
            claimed_status: c.claimed_status,
            comment: c.comment || null,
          })),
        }
      )
      // Evidence is attached after the submission exists, so a failed upload
      // never loses the verdicts just typed.
      if (file) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/acceptance/submissions/${data.id}/evidence`, form)
      }
      localStorage.removeItem(storageKey)
      await onDone('Submitted for validation')
    } catch (err) {
      onError(err, 'Could not send it. Check the form and try again.')
      onRefresh?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card-pad" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {previous && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={copyPrevious}>
            <RotateCcw size={13} /> Copy from round {previous.round_no}
          </button>
          {saved && <span className="dim" style={{ fontSize: 12 }}>Draft restored</span>}
        </div>
      )}

      <LetterFields
        number={number}
        onNumber={setNumber}
        date={date}
        onDate={setDate}
        disabled={busy}
      />

      <div>
        <div className="caps" style={{ marginBottom: 4 }}>
          What {authority} decided, per technology
        </div>
        <VerdictRows claims={claims} onChange={set} authority={authority} />
      </div>

      <EvidenceBox file={file} onFile={setFile} limits={limits} disabled={busy} />

      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={saveDraft} disabled={busy}>
          Save draft
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : `Submit ${authority}`}
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------- reviewing */

export function ReviewBody({ submission, authority, onDone, onError }) {
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState(RETURN_REASONS[0])
  const [note, setNote] = useState('')

  if (!submission) {
    return <div className="card-pad dim">Nothing is awaiting review for {authority}.</div>
  }

  const claims = submission.technologies.map((t) => ({
    technology: t.technology,
    claimed_status: t.claimed_status,
    comment: t.comment,
  }))

  async function decide(decision, comment) {
    setBusy(true)
    try {
      await api.post(`/acceptance/submissions/${submission.id}/review`, {
        decision,
        comment: comment || null,
      })
      await onDone(
        decision === 'Validated' ? 'Recorded' : 'Sent back to the submitter'
      )
    } catch (err) {
      onError(err, 'That did not go through')
    } finally {
      setBusy(false)
      setReturning(false)
    }
  }

  return (
    <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="surface-soft" style={{ padding: '12px 14px' }}>
        <div className="caps">The claim</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Letter <LetterRef value={submission.letter_number} />
          {submission.letter_date_shamsi ? (
            <>
              {' · '}
              <LetterRef value={submission.letter_date_shamsi} />
            </>
          ) : null}
          {' · '}
          {submission.submitted_by_name || 'unknown'} · {AUTHORITY_WHERE[authority]}
        </div>
      </div>

      <VerdictRows claims={claims} onChange={() => {}} authority={authority} readOnly />

      {submission.evidence.length > 0 ? (
        <div className="row wrap" style={{ gap: 8 }}>
          {submission.evidence.map((e) => (
            <EvidenceLink key={e.id} evidence={e} onError={onError} />
          ))}
        </div>
      ) : (
        <div className="dim" style={{ fontSize: 12.5 }}>No scan was attached.</div>
      )}

      {returning ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Why is it coming back?</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="">Something else</option>
            </select>
          </div>
          <input
            className="input"
            placeholder={reason ? 'Anything else the submitter needs to know (optional)' : 'What must the submitter correct?'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setReturning(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--red)' }}
              disabled={busy || !(reason || note.trim())}
              onClick={() => decide('Returned', [reason, note.trim()].filter(Boolean).join(' — '))}
            >
              Return it
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={busy} onClick={() => setReturning(true)}>
            <CornerUpLeft size={14} /> Return with reason
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => decide('Validated')}>
            <CheckCircle2 size={14} /> Approve
          </button>
        </div>
      )}
    </div>
  )
}

export function EvidenceLink({ evidence, onError }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        // The endpoint needs the bearer token, which a plain link cannot send.
        setBusy(true)
        try {
          const r = await api.get(`/acceptance/evidence/${evidence.id}/download`, {
            responseType: 'blob',
          })
          const url = URL.createObjectURL(r.data)
          const a = document.createElement('a')
          a.href = url
          a.download = evidence.original_filename
          a.click()
          URL.revokeObjectURL(url)
        } catch (err) {
          onError?.(err, 'Could not download that file')
        } finally {
          setBusy(false)
        }
      }}
    >
      <Download size={12} /> {evidence.original_filename}
    </button>
  )
}
