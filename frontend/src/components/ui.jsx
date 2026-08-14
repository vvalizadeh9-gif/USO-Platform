// Small shared presentational components. Keeping status→style mapping
// in one place avoids duplicating the logic across every table.
import { motion } from 'framer-motion'
import { Inbox } from 'lucide-react'

const STATUS_CLASS = {
  Approved: 'pill-green',
  Completed: 'pill-green',
  Ready: 'pill-cyan',
  'Ready for Assignment': 'pill-cyan',
  Pending: 'pill-amber',
  Submitted: 'pill-amber',
  'DT Submitted': 'pill-amber',
  // Coordinator approval is now terminal — an approved DT is a completed DT.
  'Coordinator Approved': 'pill-green',
  Returned: 'pill-amber',
  'Returned by Contractor': 'pill-amber',
  Assigned: 'pill-violet',
  Rejected: 'pill-red',
  Problematic: 'pill-red',
  New: 'pill-dim',
}

export function StatusPill({ status }) {
  const cls = STATUS_CLASS[status] || 'pill-dim'
  return <span className={`pill ${cls}`}>{status || '—'}</span>
}

export function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <motion.div
      className="page-head"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </motion.div>
  )
}

export function EmptyState({ title, hint }) {
  return (
    <div className="empty">
      <Inbox size={38} strokeWidth={1.5} />
      <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="row" style={{ padding: 40, justifyContent: 'center', color: 'var(--text-dim)' }}>
      <div className="spinner" />
      <span>{label}…</span>
    </div>
  )
}

// Stagger container for list/grid entrance animations.
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
}

// A reusable yes/no confirmation modal for consequential actions (marking a
// site problematic, returning an assignment, etc). Kept in the shared UI kit
// so every screen that needs a confirm step looks and behaves the same way,
// instead of each page inventing its own dialog or falling back to the
// browser's native confirm().
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'grid', placeItems: 'center', zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <motion.div
        className="card card-pad"
        style={{ maxWidth: 420, width: '90%' }}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>{title}</h3>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 18 }}>{message}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            style={danger ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
