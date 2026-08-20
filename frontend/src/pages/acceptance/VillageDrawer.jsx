import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Paperclip, Trash2, Download, ShieldCheck, Landmark,
  CheckCircle2, XCircle, Clock, CornerUpLeft,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { Loading, StatusPill } from '../../components/ui'
import ShamsiDate from './ShamsiDate'
import LetterRef from './LetterRef'

const ICT = 'var(--signal, #4f8cff)'
const CRA = 'var(--violet, #a06bff)'
const AUTHORITY_ICON = { ICT: ShieldCheck, CRA: Landmark }
const AUTHORITY_COLOR = { ICT, CRA }

function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function errorText(err, fallback) {
  return err?.response?.data?.detail || fallback
}

/**
 * One village's acceptance: where it stands, the form to file a letter, and
 * every round ever submitted for it.
 *
 * A drawer rather than a page because acceptance is worked as a list — you
 * open a village, file its letter, and carry on down the list without losing
 * your place.
 */
export default function VillageDrawer({ villageId, onClose, onChanged, canReview }) {
  const open = villageId != null
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [authority, setAuthority] = useState(null)

  const load = useCallback(() => {
    if (villageId == null) return
    api
      .get(`/acceptance/villages/${villageId}`)
      .then((r) => { setDetail(r.data); setError(null) })
      .catch(() => setError('Could not load this village.'))
  }, [villageId])

  useEffect(() => {
    if (!open) return
    setDetail(null)
    setAuthority(null)
    load()
  }, [open, villageId, load])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function refresh() {
    load()
    onChanged?.()
  }

  const village = detail?.village

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }} onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20,35,60,.34)', zIndex: 60 }}
          />
          <motion.aside
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0.32, 1] }}
            role="dialog" aria-label="Village acceptance"
            style={{
              position: 'fixed', top: 0, right: 0, height: '100vh',
              width: 'min(620px, 96vw)', background: 'var(--surface-1)',
              borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-2)',
              zIndex: 61, display: 'flex', flexDirection: 'column',
            }}
          >
            <div className="row" style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal-strong)', fontWeight: 600 }}>
                  Acceptance
                </div>
                <h3 style={{ fontSize: 19, marginTop: 4 }}>
                  {village?.village_name || village?.village_code || 'Village'}
                </h3>
                {village && (
                  <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                    Site {village.site_code} · {village.province_name || 'Unknown province'}
                  </div>
                )}
              </div>
              <div className="spacer" />
              <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
            </div>

            <div style={{ overflowY: 'auto', padding: 22 }}>
              {error && <div className="form-banner form-banner-error">{error}</div>}
              {!detail && !error && <Loading label="Loading village" />}

              {detail && (
                <>
                  <VerdictSummary village={village} />

                  {authority ? (
                    <SubmitForm
                      villageId={villageId}
                      authority={authority}
                      technologies={village.requested_technologies}
                      onCancel={() => setAuthority(null)}
                      onDone={() => { setAuthority(null); refresh() }}
                      toast={toast}
                    />
                  ) : (
                    <div className="row mt-16" style={{ gap: 8 }}>
                      {village.can_submit.map((a) => {
                        const Icon = AUTHORITY_ICON[a]
                        return (
                          <button key={a} className="btn btn-primary" onClick={() => setAuthority(a)}>
                            <span className="row" style={{ gap: 6 }}><Icon size={14} /> Submit {a} letter</span>
                          </button>
                        )
                      })}
                      {village.can_submit.length === 0 && (
                        <div className="dim" style={{ fontSize: 12.5 }}>
                          {village.pending_authorities.length > 0
                            ? `Awaiting review: ${village.pending_authorities.join(', ')}.`
                            : 'Nothing to submit — both authorities have approved this village.'}
                        </div>
                      )}
                    </div>
                  )}

                  <History
                    submissions={detail.submissions}
                    canReview={canReview}
                    onChanged={refresh}
                    toast={toast}
                  />
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------- summary --- */

function VerdictSummary({ village }) {
  return (
    <div className="card card-pad">
      <div className="row between">
        <div>
          <div className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Village verdict
          </div>
          <div className="row mt-8" style={{ gap: 8 }}>
            <StatusPill status={village.verdict} />
            <span className="dim" style={{ fontSize: 12 }}>Site is {village.site_status}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Requested
          </div>
          <div className="row mt-8" style={{ gap: 5, justifyContent: 'flex-end' }}>
            {village.requested_technologies.map((t) => (
              <span key={t} className="pill pill-dim">{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid mt-16" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {['ICT', 'CRA'].map((a) => {
          const Icon = AUTHORITY_ICON[a]
          const verdict = a === 'ICT' ? village.ict_verdict : village.cra_verdict
          return (
            <div key={a} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="row" style={{ gap: 7 }}>
                <Icon size={14} color={AUTHORITY_COLOR[a]} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{a}</span>
                <div className="spacer" />
                <StatusPill status={verdict} />
              </div>
            </div>
          )
        })}
      </div>

      {/* The rule that surprises people, stated where it applies. */}
      <div className="dim mt-8" style={{ fontSize: 11.5 }}>
        A village counts as approved only when ICT and CRA have both approved every
        requested technology. One rejected technology rejects the village.
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- submit --- */

function SubmitForm({ villageId, authority, technologies, onCancel, onDone, toast }) {
  // Only the requested technologies are ever offered. A 3G/4G site never shows
  // a 2G box, and the server refuses one if it somehow arrives.
  const [claims, setClaims] = useState(() =>
    technologies.map((t) => ({ technology: t, claimed_status: 'Approved', comment: '' }))
  )
  const [letterNumber, setLetterNumber] = useState('')
  const [letterDate, setLetterDate] = useState('')
  const [files, setFiles] = useState([])
  const [limits, setLimits] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)
  const fileInput = useRef(null)

  useEffect(() => {
    api.get('/acceptance/limits').then((r) => setLimits(r.data)).catch(() => setLimits(null))
  }, [])

  function setClaim(technology, patch) {
    setClaims((cur) => cur.map((c) => (c.technology === technology ? { ...c, ...patch } : c)))
  }

  const Icon = AUTHORITY_ICON[authority]

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
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
      // never loses the verdicts the user just typed.
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/acceptance/submissions/${data.id}/evidence`, form)
      }
      toast.success(`${authority} submission sent for review`)
      onDone()
    } catch (err) {
      setFormError(errorText(err, 'Could not submit. Check the form and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad mt-16" onSubmit={submit}>
      <div className="row" style={{ gap: 7 }}>
        <Icon size={15} color={AUTHORITY_COLOR[authority]} />
        <strong style={{ fontSize: 14 }}>{authority} letter</strong>
      </div>

      {formError && <div className="form-banner form-banner-error mt-8">{formError}</div>}

      {/* The date needs the wider half: three selects side by side. */}
      <div className="grid mt-16" style={{ gridTemplateColumns: '1fr 1.35fr', gap: 12 }}>
        <label className="field">
          <span>Letter number</span>
          {/* Same reasoning as LetterRef: a letter number is a code, so the
              characters must appear in the order they were typed rather than
              be reordered by the bidirectional algorithm around the Arabic
              letter most of these numbers contain. */}
          <input
            className="input" value={letterNumber} required maxLength={120}
            placeholder="e.g. 1404/ص/4471"
            dir="ltr" style={{ unicodeBidi: 'isolate-override' }}
            onChange={(e) => setLetterNumber(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Letter date (Shamsi)</span>
          <ShamsiDate value={letterDate} onChange={setLetterDate} disabled={busy} />
        </label>
      </div>

      <div className="mt-16">
        <div className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
          Status per requested technology
        </div>
        {claims.map((claim) => (
          <div key={claim.technology} className="mt-8" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px' }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="pill pill-dim" style={{ minWidth: 42, justifyContent: 'center' }}>{claim.technology}</span>
              <div className="row" style={{ gap: 6 }}>
                {['Approved', 'Rejected'].map((status) => {
                  const active = claim.claimed_status === status
                  const StatusIcon = status === 'Approved' ? CheckCircle2 : XCircle
                  return (
                    <button
                      key={status} type="button"
                      className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                      onClick={() => setClaim(claim.technology, { claimed_status: status })}
                    >
                      <span className="row" style={{ gap: 5 }}><StatusIcon size={13} /> {status}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            {claim.claimed_status === 'Rejected' && (
              <input
                className="input mt-8" required maxLength={1000}
                placeholder={`Why did ${authority} reject ${claim.technology}?`}
                value={claim.comment}
                onChange={(e) => setClaim(claim.technology, { comment: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-16">
        <div className="row between">
          <div className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Evidence
          </div>
          {limits && (
            <span className="dim" style={{ fontSize: 11.5 }}>
              {limits.accepted_extensions.join(', ').toUpperCase()} · up to {limits.max_file_mb} MB each
            </span>
          )}
        </div>
        <input
          ref={fileInput} type="file" multiple hidden
          accept={limits ? limits.accepted_extensions.map((e) => `.${e}`).join(',') : undefined}
          onChange={(e) => {
            setFiles((cur) => [...cur, ...Array.from(e.target.files || [])])
            e.target.value = ''
          }}
        />
        <button type="button" className="btn btn-sm mt-8" onClick={() => fileInput.current?.click()}>
          <span className="row" style={{ gap: 6 }}><Paperclip size={13} /> Attach a scan</span>
        </button>
        {files.map((file, i) => (
          <div key={`${file.name}-${i}`} className="row mt-8" style={{ gap: 8, fontSize: 12.5 }}>
            <Paperclip size={12} className="dim" />
            <span>{file.name}</span>
            <div className="spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="row mt-16" style={{ gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send for review'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------- history --- */

function History({ submissions, canReview, onChanged, toast }) {
  if (!submissions.length) {
    return (
      <div className="dim mt-24" style={{ fontSize: 12.5 }}>
        Nothing has been submitted for this village yet.
      </div>
    )
  }
  return (
    <div className="mt-24">
      <div className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
        History — every round, both authorities
      </div>
      {submissions.map((s) => (
        <SubmissionCard
          key={s.id} submission={s} canReview={canReview}
          onChanged={onChanged} toast={toast}
        />
      ))}
    </div>
  )
}

function SubmissionCard({ submission: s, canReview, onChanged, toast }) {
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const Icon = AUTHORITY_ICON[s.authority]

  async function review(decision, comment) {
    setBusy(true)
    try {
      await api.post(`/acceptance/submissions/${s.id}/review`, { decision, comment: comment || null })
      toast.success(decision === 'Validated' ? 'Validated into the record' : 'Returned to the submitter')
      onChanged()
    } catch (err) {
      toast.error(errorText(err, 'Could not record that decision'))
    } finally {
      setBusy(false)
      setReturning(false)
    }
  }

  return (
    <div className="card card-pad mt-8">
      <div className="row" style={{ gap: 8 }}>
        <Icon size={14} color={AUTHORITY_COLOR[s.authority]} />
        <strong style={{ fontSize: 13 }}>{s.authority}</strong>
        <span className="dim" style={{ fontSize: 12 }}>round {s.round_no}</span>
        <div className="spacer" />
        <StatusPill status={s.review_status} />
      </div>

      <div className="dim mt-8" style={{ fontSize: 12 }}>
        Letter <LetterRef value={s.letter_number} />
        {s.letter_date_shamsi ? <> · <LetterRef value={s.letter_date_shamsi} /></> : null}
        {' · '}by {s.submitted_by_name || 'unknown'} ({s.source}) on {formatDateTime(s.submitted_at)}
      </div>

      <div className="row wrap mt-8" style={{ gap: 6 }}>
        {s.technologies.map((t) => (
          <span
            key={t.technology}
            className={`pill ${t.claimed_status === 'Approved' ? 'pill-green' : 'pill-red'}`}
            title={t.comment || ''}
          >
            {t.technology} {t.claimed_status}
          </span>
        ))}
      </div>

      {s.technologies.filter((t) => t.comment).map((t) => (
        <div key={`${t.technology}-c`} className="dim mt-8" style={{ fontSize: 12 }}>
          <strong>{t.technology}:</strong> {t.comment}
        </div>
      ))}

      {s.evidence.length > 0 && (
        <div className="row wrap mt-8" style={{ gap: 8 }}>
          {s.evidence.map((e) => (
            <a
              key={e.id} className="btn btn-sm" href={`/api/v1/acceptance/evidence/${e.id}/download`}
              onClick={async (ev) => {
                // The endpoint needs the bearer token, which a plain link
                // cannot send — fetch it through the API client instead.
                ev.preventDefault()
                const r = await api.get(`/acceptance/evidence/${e.id}/download`, { responseType: 'blob' })
                const url = URL.createObjectURL(r.data)
                const a = document.createElement('a')
                a.href = url
                a.download = e.original_filename
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <span className="row" style={{ gap: 5 }}><Download size={12} /> {e.original_filename}</span>
            </a>
          ))}
        </div>
      )}

      {s.review_status !== 'Pending' && s.reviewed_by_name && (
        <div className="dim mt-8" style={{ fontSize: 12 }}>
          <Clock size={11} style={{ verticalAlign: -1 }} />{' '}
          {s.review_status} by {s.reviewed_by_name} on {formatDateTime(s.reviewed_at)}
          {s.review_comment ? ` — ${s.review_comment}` : ''}
        </div>
      )}

      {canReview && s.review_status === 'Pending' && (
        <div className="mt-16">
          {returning ? (
            <div>
              <input
                className="input" autoFocus placeholder="What must the submitter correct?"
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
              <div className="row mt-8" style={{ gap: 8 }}>
                <button className="btn btn-sm btn-primary" disabled={busy || !reason.trim()} onClick={() => review('Returned', reason)}>
                  Return it
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setReturning(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => review('Validated')}>
                <span className="row" style={{ gap: 5 }}><CheckCircle2 size={13} /> Validate</span>
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setReturning(true)}>
                <span className="row" style={{ gap: 5 }}><CornerUpLeft size={13} /> Return</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
