// The shared UI kit.
//
// Everything here is presentational. The classes it renders are defined in
// styles/base.css, which keeps the design decisions in one place and out of
// forty screens — a page asks for a Button, not for a particular combination
// of border, padding and hover colour.
//
// The primitives are deliberately thin wrappers over real HTML: a Button is a
// <button>, a Table is a <table>. Anything a page passes through — onClick,
// type, name, aria-*, style — reaches the element, so adopting a primitive
// never costs a screen a capability it already had.
import { forwardRef, useEffect, useId } from 'react'
import { motion } from 'framer-motion'
import { Inbox } from 'lucide-react'

const cx = (...parts) => parts.filter(Boolean).join(' ')

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

// Semantic tone → the class that paints it. Colour is the fast read, but it is
// never the only one: a badge always carries its label, and the indicator is a
// solid dot for a settled state and a ring for one still in flight (see .pill).
const TONE_CLASS = {
  ready: 'pill-cyan',        // emerald — waiting to be picked up
  done: 'pill-green',        // emerald — terminal, successful
  ongoing: 'pill-amber',     // amber — in progress
  pending: 'pill-amber',     // amber — waiting on someone
  problematic: 'pill-red',   // rose — needs intervention
  blocked: 'pill-red',       // rose — cannot proceed
  active: 'pill-blue',       // blue — informational / live
  info: 'pill-blue',
  assigned: 'pill-violet',   // the platform's assignment colour
  neutral: 'pill-dim',       // slate — no state
}

// The colour names are accepted too, so the screens that already write
// `pill pill-amber` by hand can move to <Badge> one at a time.
const ALIAS = {
  green: 'pill-green',
  cyan: 'pill-cyan',
  amber: 'pill-amber',
  red: 'pill-red',
  blue: 'pill-blue',
  violet: 'pill-violet',
  dim: 'pill-dim',
}

function toneClass(tone) {
  return TONE_CLASS[tone] || ALIAS[tone] || 'pill-dim'
}

export function Badge({ tone = 'neutral', size, className, children, ...rest }) {
  return (
    <span
      className={cx('pill', toneClass(tone), size === 'xs' && 'pill-xs', className)}
      {...rest}
    >
      {children}
    </span>
  )
}

// Workflow stage → tone. The stage names are the backend's (see
// services/workflow.py); this only decides how each one looks.
const STATUS_TONE = {
  Approved: 'done',
  Completed: 'done',
  Ready: 'ready',
  'Ready for Assignment': 'ready',
  Pending: 'pending',
  Submitted: 'pending',
  'DT Submitted': 'pending',
  // Coordinator approval is now terminal — an approved DT is a completed DT.
  'Coordinator Approved': 'done',
  Returned: 'pending',
  'Returned by Contractor': 'pending',
  Assigned: 'assigned',
  Rejected: 'problematic',
  Problematic: 'problematic',
  New: 'neutral',
}

export function StatusPill({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{status || '—'}</Badge>
}

// ---------------------------------------------------------------------------
// Technical typography
//
// The interface is LTR, but its data is not: province and village names are
// Persian, and a site code sitting next to one will have its hyphens and
// digits reordered by the Unicode bidi algorithm unless it is isolated. These
// two are how a screen says "this string is technical".
// ---------------------------------------------------------------------------

export function Mono({ as: As = 'span', className, children, ...rest }) {
  return <As className={cx('mono', className)} {...rest}>{children}</As>
}

// The primary scanning element of an operational row: the identifier loud and
// monospaced, its context quiet underneath. `meta` is whatever the caller
// already has — this invents nothing.
export function SiteId({ value, meta, className, ...rest }) {
  return (
    <div className={className} {...rest}>
      <div className="cell-primary">{value || '—'}</div>
      {meta ? <div className="cell-meta">{meta}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

// `accent` draws a 2px rule along the top edge in a semantic colour:
// 'signal' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'neutral'.
export function Card({ accent, pad = false, as: As = 'div', className, children, ...rest }) {
  return (
    <As
      className={cx('card', pad && 'card-pad', className)}
      data-accent={accent || undefined}
      {...rest}
    >
      {children}
    </As>
  )
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const BUTTON_VARIANT = {
  default: '',
  primary: 'btn-primary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
}

export const Button = forwardRef(function Button(
  { variant = 'default', size, loading = false, disabled = false, type = 'button',
    className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', BUTTON_VARIANT[variant], size === 'sm' && 'btn-sm', className)}
      // A loading button stays in the DOM and stays focused, but stops
      // accepting the click that is already in flight.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

// Wires the label, the error and the hint to the control for you: pass a
// function child and it receives the props the control needs.
export function Field({ label, error, hint, required, htmlFor, className, children }) {
  const auto = useId()
  const id = htmlFor || auto
  const errorId = error ? `${id}-error` : undefined
  const hintId = hint ? `${id}-hint` : undefined
  const describedBy = cx(errorId, hintId) || undefined

  const controlProps = {
    id,
    error: Boolean(error),
    'aria-describedby': describedBy,
    required: required || undefined,
  }

  return (
    <div className={cx('field', className)}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span className="field-req" aria-hidden="true">*</span>}
        </label>
      )}
      {typeof children === 'function' ? children(controlProps) : children}
      {hint && !error && <span className="field-hint" id={hintId}>{hint}</span>}
      {/* assertive would interrupt a screen reader mid-word on every
          keystroke; a validation message is worth hearing, not urgent. */}
      {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
    </div>
  )
}

export const Input = forwardRef(function Input(
  { error = false, mono = false, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('input', error && 'input-error', mono && 'input-mono', className)}
      aria-invalid={error || undefined}
      // A technical field holds an identifier, not prose: pin it LTR so a
      // reference code reads back the way it was typed.
      dir={mono ? 'ltr' : undefined}
      {...rest}
    />
  )
})

export const Select = forwardRef(function Select(
  { error = false, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx('input', error && 'input-error', className)}
      aria-invalid={error || undefined}
      {...rest}
    >
      {children}
    </select>
  )
})

// ---------------------------------------------------------------------------
// Table
//
// An operational list. No vertical rules — columns are held apart by
// alignment and whitespace — with hairline row dividers and a frosted header.
//
// Sticky headers resolve against the nearest scrolling ancestor, so a screen
// that wants the header pinned gives the table a `maxHeight`; without one the
// table simply grows and the page scrolls.
// ---------------------------------------------------------------------------

export function Table({ dense = false, maxHeight, wrapClassName, wrapStyle, className, children, ...rest }) {
  return (
    <div
      className={cx('table-wrap', wrapClassName)}
      style={maxHeight ? { maxHeight, ...wrapStyle } : wrapStyle}
    >
      <table className={cx(dense && 'is-dense', className)} {...rest}>
        {children}
      </table>
    </div>
  )
}

Table.Head = function TableHead({ children, ...rest }) {
  return <thead {...rest}>{children}</thead>
}

Table.Body = function TableBody({ children, ...rest }) {
  return <tbody {...rest}>{children}</tbody>
}

// `numeric` right-aligns the column so figures line up under each other.
Table.HeaderCell = function TableHeaderCell({ numeric = false, className, children, ...rest }) {
  return (
    <th scope="col" className={cx(numeric && 'cell-num', className)} {...rest}>
      {children}
    </th>
  )
}

Table.Cell = function TableCell({ numeric = false, primary = false, className, children, ...rest }) {
  return (
    <td className={cx(numeric && 'cell-num', primary && 'cell-primary', className)} {...rest}>
      {children}
    </td>
  )
}

// A clickable row is reachable from the keyboard. It stays a <tr> rather than
// taking role="button", which would cost the row its place in the table for
// anyone reading with a screen reader.
Table.Row = function TableRow({ selected = false, onClick, className, children, ...rest }) {
  const interactive = Boolean(onClick)
  return (
    <tr
      className={cx(selected && 'is-selected', interactive && 'is-clickable', className)}
      onClick={onClick}
      tabIndex={interactive ? 0 : undefined}
      aria-selected={selected || undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick(e)
              }
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

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
      <Inbox size={34} strokeWidth={1.5} />
      <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading' }) {
  return (
    <div
      className="row"
      style={{ padding: 40, justifyContent: 'center', color: 'var(--text-dim)' }}
      role="status"
      aria-live="polite"
    >
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
  const titleId = useId()

  // Escape cancels, as it does in every other dialog on the platform — but
  // not while the action is in flight, when there is nothing left to cancel.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed', inset: 0, background: 'var(--scrim)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        display: 'grid', placeItems: 'center', zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <motion.div
        className="card card-pad"
        style={{ maxWidth: 420, width: '90%', boxShadow: 'var(--shadow-2)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} style={{ fontSize: 15, marginBottom: 8 }}>{title}</h3>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>{message}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {busy ? 'Please wait…' : confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
