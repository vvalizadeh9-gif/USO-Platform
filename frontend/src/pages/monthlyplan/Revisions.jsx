import { motion } from 'framer-motion'
import { X } from '../../components/carbon'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading, StatusPill } from '../../components/ui'
import { streamMeta } from './streams'

/**
 * Every version of one contractor's plan for one month, oldest first.
 *
 * A revision is only legible next to the thing that caused it, so each
 * returned version carries the PM's comment underneath it rather than in a
 * column. Read top to bottom the panel is the argument the two of them had
 * about the number.
 *
 * One stream at a time (DT or Acceptance): the two are separate plans with
 * separate version histories.
 *
 * Nothing here is reconstructed. The plan table keeps a row per version — that
 * is what the append-on-revision rule is for — and this reads them.
 */
export default function Revisions({ period, stream = 'DT', isContractor, onClose }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setData(null)
    setFailed(false)
    api
      .get('/pip/revisions', {
        params: {
          year: period.year,
          month: period.month,
          stream,
          // Sent only by a staff account. A contractor's own id is read off
          // their session by the server, which ignores this parameter for
          // them — so the contractor screen cannot name a company at all.
          ...(isContractor ? {} : { contractor_id: period.contractorId }),
        },
      })
      .then((r) => setData(r.data))
      .catch(() => setFailed(true))
  }, [period, stream, isContractor])

  return (
    <motion.div
      className="card mt-16"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="row wrap" style={{ padding: '16px 20px', borderBottom: '1px solid var(--uep-border)' }}>
        <b style={{ fontFamily: 'var(--uep-font-sans)', fontSize: 'var(--uep-fs-15)' }}>Revision history</b>
        {data && (
          <span className="dim text-data" style={{ fontSize: 13 }}>
            {data.contractor_name} · {streamMeta(data.stream).short} · {data.shamsi_month_name} {data.shamsi_year}
          </span>
        )}
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close revision history">
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: 20 }}>
        {failed ? (
          <div className="empty">Could not load the revisions.</div>
        ) : !data ? (
          <Loading label="Loading revisions" />
        ) : data.revisions.length === 0 ? (
          <div className="empty">No plan was filed for this month.</div>
        ) : (
          <div style={{ display: 'grid', gap: 0 }}>
            {data.revisions.map((r, i) => (
              <Entry key={r.version} entry={r} last={i === data.revisions.length - 1} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function Entry({ entry, last }) {
  const tone =
    entry.status === 'Approved'
      ? 'var(--uep-status-success-ink)'
      : entry.status === 'Returned'
        ? 'var(--uep-status-danger-ink)'
        : 'var(--uep-status-pending-ink)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: tone,
            marginTop: 5,
            flexShrink: 0,
          }}
        />
        {!last && <span style={{ flex: 1, width: 2, background: 'var(--uep-border)', minHeight: 14 }} />}
      </div>

      <div style={{ paddingBottom: last ? 0 : 18 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill pill-dim">v{entry.version}</span>
          <StatusPill status={entry.status} />
          <span className="tnum" style={{ fontFamily: 'var(--uep-font-sans)', fontWeight: 600 }}>
            {entry.committed_count ?? '—'}
          </span>
          {entry.is_late && <span className="pill pill-amber">Late</span>}
          {entry.is_current && <span className="pill pill-cyan">Current</span>}
        </div>

        <div className="dim" style={{ fontSize: 'var(--uep-fs-caption)', marginTop: 3 }}>
          {entry.submitted_shamsi && <>Handed in {entry.submitted_shamsi}</>}
          {entry.decided_shamsi && (
            <>
              {entry.submitted_shamsi ? ' · ' : ''}
              Decided {entry.decided_shamsi}
              {entry.decided_by ? ` by ${entry.decided_by}` : ''}
            </>
          )}
        </div>

        {entry.return_comment && (
          <div
            style={{
              background: 'var(--uep-surface-subtle)',
              borderInlineStart: '2px solid var(--uep-status-pending-ink)',
              padding: '8px 11px',
              borderRadius: '0 6px 6px 0',
              fontSize: 'var(--uep-fs-small)',
              color: 'var(--uep-text-2)',
              marginTop: 8,
              fontFamily: 'var(--uep-font-persian)',
              lineHeight: 1.6,
            }}
          >
            {entry.return_comment}
          </div>
        )}
      </div>
    </div>
  )
}
