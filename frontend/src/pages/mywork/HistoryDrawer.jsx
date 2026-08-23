import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import LetterRef from '../../components/LetterRef'
import { StatusPill } from '../../components/ui'
import { AUTHORITY_WHERE } from './status'
import { EvidenceLink } from './SubmissionForm'

function shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Every round this village has ever had, both authorities, oldest first.
 *
 * Rounds are append-only and this is why: a village rejected, fixed and
 * re-sent has both attempts on the record, with who decided each and on what
 * grounds. It is what makes an argument about an acceptance date settleable
 * years later, so nothing here is ever summarised away.
 */
export default function HistoryDrawer({ village, submissions, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ordered = [...submissions].sort(
    (a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)
  )

  return (
    <AnimatePresence>
      <motion.div
        key="scrim"
        className="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />
      <motion.aside
        key="drawer"
        className="drawer"
        role="dialog"
        aria-label="Acceptance history"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.26, ease: [0.32, 0.72, 0.32, 1] }}
      >
        <header>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16 }}>
              {village.village_name || village.village_code || 'Village'}
            </h3>
            <div className="dim" style={{ fontSize: 12 }}>
              {ordered.length} round{ordered.length === 1 ? '' : 's'} · both authorities
            </div>
          </div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ordered.length === 0 && (
            <div className="empty">Nothing has been filed for this village yet.</div>
          )}
          {ordered.map((s) => (
            <article key={s.id} className="card card-pad">
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: 13.5 }}>
                  {s.authority} · round {s.round_no}
                </strong>
                <span className="dim" style={{ fontSize: 11.5 }}>
                  {AUTHORITY_WHERE[s.authority]}
                </span>
                <span className="spacer" />
                <StatusPill status={s.review_status} />
              </div>

              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                Letter <LetterRef value={s.letter_number} />
                {s.letter_date_shamsi ? (
                  <>
                    {' · '}
                    <LetterRef value={s.letter_date_shamsi} />
                  </>
                ) : null}
              </div>

              <div className="row wrap mt-8" style={{ gap: 5 }}>
                {s.technologies.map((t) => (
                  <span
                    key={t.technology}
                    className={`pill pill-xs ${
                      t.claimed_status === 'Approved' ? 'pill-green' : 'pill-red'
                    }`}
                  >
                    {t.technology}
                  </span>
                ))}
              </div>

              {s.technologies
                .filter((t) => t.comment)
                .map((t) => (
                  <div key={t.technology} className="dim mt-8" style={{ fontSize: 12.5 }}>
                    <strong>{t.technology}:</strong> {t.comment}
                  </div>
                ))}

              {s.review_comment && (
                <div className="reason mt-8">{s.review_comment}</div>
              )}

              <div className="dim mt-8" style={{ fontSize: 11.5 }}>
                Submitted by {s.submitted_by_name || 'unknown'} on {shortDate(s.submitted_at)}
                {s.reviewed_at
                  ? ` · ${s.review_status.toLowerCase()} by ${
                      s.reviewed_by_name || 'a reviewer'
                    } on ${shortDate(s.reviewed_at)}`
                  : ''}
              </div>

              {s.evidence.length > 0 && (
                <div className="row wrap mt-8" style={{ gap: 6 }}>
                  {s.evidence.map((e) => (
                    <EvidenceLink key={e.id} evidence={e} />
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
