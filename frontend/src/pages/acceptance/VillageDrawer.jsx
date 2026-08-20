import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { Loading, StatusPill } from '../../components/ui'
import AuthorityPanel from './AuthorityPanel'

/**
 * One village, split down the middle: ICT on the left, CRA on the right.
 *
 * Both authorities are visible at once because that is the question being
 * asked — where does this village stand — and hiding one behind a button made
 * you click to find out.
 */
export default function VillageDrawer({ villageId, onClose, onChanged, canReview }) {
  const open = villageId != null
  const { user } = useAuth()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    if (villageId == null) return
    api
      .get(`/acceptance/villages/${villageId}`)
      .then((r) => { setDetail(r.data); setError(null) })
      .catch(() => setError('Could not load this village.'))
  }, [villageId])

  useEffect(() => { if (open) { setDetail(null); load() } }, [open, villageId, load])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function refresh() { load(); onChanged?.() }

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
              width: 'min(920px, 100vw)', background: 'var(--bg)',
              borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-2)',
              zIndex: 61, display: 'flex', flexDirection: 'column',
            }}
          >
            <header
              className="row"
              style={{
                padding: '18px 22px', background: 'var(--surface-1)',
                borderBottom: '1px solid var(--border)', alignItems: 'flex-start', gap: 14,
              }}
            >
              <div>
                <h3 style={{ fontSize: 19, lineHeight: 1.2 }}>
                  {village?.village_name || village?.village_code || 'Village'}
                </h3>
                {village && (
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>
                    {village.village_code} · site {village.site_code} · {village.province_name || 'Unknown province'}
                  </div>
                )}
              </div>
              <div className="spacer" />
              {village && (
                <div style={{ textAlign: 'right' }}>
                  <div className="dim" style={{ fontSize: 10.5, letterSpacing: '.11em', textTransform: 'uppercase' }}>
                    Final
                  </div>
                  <div style={{ marginTop: 4 }}><StatusPill status={village.verdict} /></div>
                </div>
              )}
              <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
            </header>

            <div style={{ overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && <div className="form-banner form-banner-error">{error}</div>}
              {!detail && !error && <Loading label="Loading village" />}

              {detail && (
                <>
                  <div className="row wrap" style={{ gap: 10 }}>
                    <span className="dim" style={{ fontSize: 12.5 }}>Requested by CPM:</span>
                    {village.requested_technologies.map((t) => (
                      <span key={t} className="tech-chip">{t}</span>
                    ))}
                    <div className="spacer" />
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      Site is {village.site_status}
                    </span>
                  </div>

                  <div className="auth-grid">
                    {['ICT', 'CRA'].map((authority) => (
                      <AuthorityPanel
                        key={authority}
                        authority={authority}
                        village={village}
                        submissions={detail.submissions}
                        canReview={canReview}
                        currentUserName={user?.full_name}
                        onChanged={refresh}
                      />
                    ))}
                  </div>

                  <p className="dim" style={{ fontSize: 12, maxWidth: 640 }}>
                    A village is approved only when ICT and CRA have both approved every
                    requested technology. One rejected technology rejects the village.
                  </p>
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
