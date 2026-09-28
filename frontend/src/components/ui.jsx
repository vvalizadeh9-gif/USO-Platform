// Small shared presentational components. Keeping status→style mapping
// in one place avoids duplicating the logic across every table.
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Inbox, Info, XCircle } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

const STATUS_CLASS = {
  Approved: 'pill-green',
  Completed: 'pill-green',
  Ready: 'pill-cyan',
  'Ready for Assignment': 'pill-cyan',
  Pending: 'pill-amber',
  Submitted: 'pill-amber',
  'DT Submitted': 'pill-amber',
  // Coordinator approval is now terminal — an approved DT is a completed DT.
  'DT Done': 'pill-green',
  Returned: 'pill-amber',
  RevisionRequested: 'pill-violet',
  RevisionReturned: 'pill-amber',
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

/**
 * A row of tabs over one panel. `tabs` is [{ key, label }]; the parent owns
 * which is selected. Left/Right move along the row and select as they go
 * (Home/End jump to the ends), and only the selected tab is in the Tab order,
 * so the row is one stop for the keyboard rather than one per tab.
 */
export function Tabs({ tabs, value, onChange, label, className = '' }) {
  const listRef = useRef(null)

  const onKeyDown = (event) => {
    const index = tabs.findIndex((tab) => tab.key === value)
    let next = null
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    onChange(tabs[next].key)
    listRef.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }

  return (
    <div
      className={`ui-tabs ${className}`.trim()}
      role="tablist"
      aria-label={label}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One choice out of a few, drawn as a single control: pressed buttons in a
 * track. `options` is [{ key, label }]. Every option is a real button with
 * `aria-pressed`, so a screen reader hears which one is on; Left/Right move
 * the choice along the row like a radio group.
 */
export function SegmentedControl({ options, value, onChange, label, className = '' }) {
  const groupRef = useRef(null)

  const onKeyDown = (event) => {
    const index = options.findIndex((option) => option.key === value)
    let next = null
    if (event.key === 'ArrowRight') next = (index + 1) % options.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length
    if (next === null) return
    event.preventDefault()
    onChange(options[next].key)
    groupRef.current?.querySelectorAll('button')[next]?.focus()
  }

  return (
    <div
      className={`ui-seg ${className}`.trim()}
      role="group"
      aria-label={label}
      ref={groupRef}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="ui-seg-option"
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A white card on the canvas. The header is optional: a neutral icon chip, a
 * title, a line of description and an actions slot at the far end.
 * Everything else is the card's body.
 */
export function Card({
  icon: Icon,
  title,
  titleAs: Title = 'h2',
  description,
  actions,
  className = '',
  children,
  ...rest
}) {
  const hasHead = Icon || title || description || actions
  return (
    <section className={`ui-card ${className}`.trim()} {...rest}>
      {hasHead && (
        <header className="ui-card-head">
          {Icon && (
            <span className="ui-card-chip" aria-hidden="true">
              <Icon size={20} strokeWidth={1.9} />
            </span>
          )}
          {(title || description) && (
            <div className="ui-card-titles">
              {title && <Title className="ui-card-title">{title}</Title>}
              {description && <div className="ui-card-desc">{description}</div>}
            </div>
          )}
          {actions && <div className="ui-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

const BANNER_ICON = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
}

/**
 * A message about the page itself -- scope, data quality, a failure, a done
 * thing. The tone sets the colour and the icon; the text always says it too.
 * An error is announced (`role="alert"`); the others are notes.
 */
export function Banner({ tone = 'info', title, children, className = '', ...rest }) {
  const Icon = BANNER_ICON[tone] || Info
  return (
    <div
      className={`banner banner-${tone} ${className}`.trim()}
      role={tone === 'error' ? 'alert' : 'note'}
      {...rest}
    >
      <Icon className="banner-icon" size={18} strokeWidth={2} aria-hidden="true" />
      <div className="banner-body">
        {title && <strong className="banner-title">{title}</strong>}
        {title && ' '}
        {children}
      </div>
    </div>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The keyboard contract every dialog shares: focus moves into the panel when
 * it opens, Tab and Shift+Tab stay inside it, Escape asks to close, and focus
 * goes back to whatever had it before when the panel goes away.
 */
function useDialogFocus(open, panelRef, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const panel = panelRef.current
    const first = panel?.querySelector(FOCUSABLE)
    ;(first || panel)?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    panel?.addEventListener('keydown', onKeyDown)
    return () => {
      panel?.removeEventListener('keydown', onKeyDown)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, panelRef])
}

/**
 * A centred dialog over the page. One backdrop for every dialog and drawer
 * (`.scrim`), and a place on the z-index scale above drawers, so a confirm
 * step opened from a drawer lands on top of it.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', labelledBy }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)
  if (!open) return null
  return (
    <>
      <div className="scrim scrim-modal" onClick={onClose} />
      <div className="modal-wrap modal-wrap-top">
        <motion.div
          ref={panelRef}
          className={`modal modal-${size}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy || (title ? titleId : undefined)}
          tabIndex={-1}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18 }}
        >
          {title && (
            <header>
              <h2 className="modal-title" id={titleId}>{title}</h2>
            </header>
          )}
          <div className="body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </motion.div>
      </div>
    </>
  )
}

/**
 * A panel that slides in from the inline-end edge, over the same backdrop as
 * a dialog. Same keyboard contract as Modal.
 */
export function Drawer({ open, onClose, title, children, footer }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus(open, panelRef, onClose)
  if (!open) return null
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <motion.aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        {title && (
          <header>
            <h2 className="modal-title" id={titleId}>{title}</h2>
          </header>
        )}
        <div className="body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </motion.aside>
    </>
  )
}

// A reusable yes/no confirmation modal for consequential actions (marking a
// site problematic, returning an assignment, etc). Kept in the shared UI kit
// so every screen that needs a confirm step looks and behaves the same way,
// instead of each page inventing its own dialog or falling back to the
// browser's native confirm().
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      // Escape and the backdrop are both a Cancel, as the backdrop always was.
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-message">{message}</p>
    </Modal>
  )
}
