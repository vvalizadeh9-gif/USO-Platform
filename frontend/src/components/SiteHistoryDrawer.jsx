import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../api/client'
import { Loading } from './ui'

// Each kind of event gets a dot colour so a long history can be skimmed for
// the shape of it — where it failed, who fixed it — without reading every row.
const DOT = {
  passed: 'var(--green)',
  failed: 'var(--red)',
  routed: 'var(--amber)',
  fixed: 'var(--signal)',
  assigned: 'var(--border)',
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The full health-check history for one site, as a right-hand drawer.
 *
 * Deliberately a drawer rather than a page: history is something you check
 * *while* doing something else (triaging, working a fix), so it should not
 * cost you your place. Open it from any site code, anywhere.
 */
export default function SiteHistoryDrawer({ workItemId, siteCode, onClose }) {
  const open = workItemId != null
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let active = true
    setEvents(null)
    setError(null)
    api
      .get(`/hc/sites/${workItemId}/history`)
      .then((r) => {
        if (active) setEvents(r.data)
      })
      .catch(() => {
        if (active) setError('Could not load this history. Try again.')
      })
    return () => {
      active = false
    }
  }, [open, workItemId])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Group into rounds so each pass through the loop reads as its own block.
  const rounds = []
  for (const ev of events || []) {
    const last = rounds[rounds.length - 1]
    if (last && last.round === ev.round_no) last.events.push(ev)
    else rounds.push({ round: ev.round_no, events: [ev] })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(20,35,60,.34)',
              zIndex: 60,
            }}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0.32, 1] }}
            role="dialog"
            aria-label={`History for ${siteCode || 'site'}`}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              height: '100vh',
              width: 'min(520px, 94vw)',
              background: 'var(--surface-1)',
              borderLeft: '1px solid var(--border)',
              boxShadow: 'var(--shadow-2)',
              zIndex: 61,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              className="row"
              style={{
                padding: '20px 22px',
                borderBottom: '1px solid var(--border)',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--signal-strong)',
                    fontWeight: 600,
                  }}
                >
                  Site history
                </div>
                <h3 style={{ fontSize: 19, marginTop: 4 }}>{siteCode || 'Site'}</h3>
              </div>
              <div className="spacer" />
              <button className="btn btn-sm" onClick={onClose} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: 22 }}>
              {error && <div className="form-banner form-banner-error">{error}</div>}
              {!events && !error && <Loading label="Loading history" />}
              {events && events.length === 0 && (
                <div className="dim" style={{ fontSize: 13 }}>
                  This site has not been health-checked yet.
                </div>
              )}

              {rounds.map((group) => (
                <div key={group.round} style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--text-dim)',
                      marginBottom: 14,
                    }}
                  >
                    Round {group.round}
                  </div>
                  <div style={{ position: 'relative', paddingLeft: 24 }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: 4,
                        top: 6,
                        bottom: 6,
                        width: 2,
                        background: 'var(--border)',
                      }}
                    />
                    {group.events.map((ev, i) => (
                      <div
                        key={`${ev.kind}-${ev.at}-${i}`}
                        style={{ position: 'relative', paddingBottom: 18 }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            left: -24,
                            top: 4,
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            background: DOT[ev.kind] || 'var(--border)',
                          }}
                        />
                        <div
                          className="tnum"
                          style={{ fontSize: 11.5, color: 'var(--text-dim)' }}
                        >
                          {formatDate(ev.at)}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
                          {ev.title}
                        </div>
                        {ev.detail && (
                          <div
                            className="muted"
                            style={{ fontSize: 13, marginTop: 3 }}
                          >
                            {ev.detail}
                          </div>
                        )}
                        {(ev.actor || ev.aging) && (
                          <div
                            className="dim"
                            style={{ fontSize: 12, marginTop: 3 }}
                          >
                            {[ev.actor, ev.aging].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/** Renders a site code that opens the history drawer when clicked. */
export function SiteCodeButton({ workItemId, siteCode, onOpen }) {
  return (
    <button
      onClick={() => onOpen(workItemId, siteCode)}
      title="View this site's health-check history"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        fontWeight: 600,
        color: 'var(--text)',
        cursor: 'pointer',
        fontVariantNumeric: 'tabular-nums',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--signal-strong)'
        e.currentTarget.style.textDecoration = 'underline'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text)'
        e.currentTarget.style.textDecoration = 'none'
      }}
    >
      {siteCode || `Site ${workItemId}`}
    </button>
  )
}
