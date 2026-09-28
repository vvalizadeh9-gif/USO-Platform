// Small shared presentational components. Keeping status→style mapping
// in one place avoids duplicating the logic across every table.
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronRight, Inbox, Info, XCircle } from 'lucide-react'
import { Fragment, useEffect, useId, useRef } from 'react'

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
 *
 * A tab may also carry:
 *
 * * `icon` -- a lucide icon drawn before the label;
 * * `count` -- a neutral count chip (accent on the selected tab), shown when
 *   above zero;
 * * `alert` -- a second chip in danger ink, e.g. "4 late";
 * * `group` -- the key of an entry in `groups` ({ [key]: { label, icon,
 *   title } }). Consecutive tabs of one group are drawn together in a
 *   track-coloured container under the group's label;
 * * `end` -- pushed to the far end of the row, after a divider. End tabs go
 *   last in the array, so the keyboard order is the visual one.
 *
 * With `steps`, a chevron sits between the parts of the row (not inside a
 * group, and not before an end tab): the tabs are a process, in order.
 */
export function Tabs({ tabs, value, onChange, label, className = '', steps = false, groups = {} }) {
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

  const renderTab = (tab) => (
    <TabButton key={tab.key} tab={tab} selected={tab.key === value} onSelect={onChange} />
  )

  return (
    <div
      className={`ui-tabs ${className}`.trim()}
      role="tablist"
      aria-label={label}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      {tabSegments(tabs).map((segment, i) => {
        const chevron = steps && i > 0 && !segment.end && (
          <ChevronRight size={14} className="ui-tab-sep" aria-hidden="true" />
        )
        if (segment.end) {
          return (
            <div key={segment.id} className="ui-tab-end">
              {segment.tabs.map(renderTab)}
            </div>
          )
        }
        if (segment.group) {
          const group = groups[segment.group] || {}
          const GroupIcon = group.icon
          return (
            <Fragment key={segment.id}>
              {chevron}
              <div className="ui-tab-group" role="presentation">
                <span className="ui-tab-group-label" title={group.title}>
                  {GroupIcon && <GroupIcon size={14} aria-hidden="true" />}
                  {group.label}
                </span>
                {segment.tabs.map(renderTab)}
              </div>
            </Fragment>
          )
        }
        return (
          <Fragment key={segment.id}>
            {chevron}
            {segment.tabs.map(renderTab)}
          </Fragment>
        )
      })}
    </div>
  )
}

/** The row split into its parts: single tabs, runs of one group, and the
 * end tabs, in order. */
function tabSegments(tabs) {
  const segments = []
  for (const tab of tabs) {
    const last = segments[segments.length - 1]
    if (tab.end) {
      if (last?.end) last.tabs.push(tab)
      else segments.push({ id: `end-${tab.key}`, end: true, tabs: [tab] })
    } else if (tab.group && last?.group === tab.group) {
      last.tabs.push(tab)
    } else {
      segments.push({ id: tab.group ? `group-${tab.key}` : tab.key, group: tab.group, tabs: [tab] })
    }
  }
  return segments
}

function TabButton({ tab, selected, onSelect }) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      role="tab"
      className="ui-tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(tab.key)}
    >
      {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden="true" />}
      {tab.label}
      {tab.count > 0 && <span className="ui-tab-count tnum">{tab.count}</span>}
      {tab.alert && <span className="ui-tab-alert tnum">{tab.alert}</span>}
    </button>
  )
}

/**
 * The header of a one-screen page, the same on every page that has one.
 *
 * Row 1: the eyebrow over the title, then `context` after a divider (a
 * process stepper, a scope button), then `actions` pushed to the far end.
 * Row 2, when there are `tabs`: the page's tabs (normally a `<Tabs>`), then
 * `tabsRight` -- the controls that act on the tab's view -- at the far end.
 */
export function PageBar({ eyebrow, title, context, actions, tabs, tabsRight }) {
  return (
    <header className="page-bar">
      <div className="page-bar-row">
        <div className="page-bar-titles">
          {eyebrow && <div className="page-bar-eyebrow">{eyebrow}</div>}
          <h1 className="page-bar-title">{title}</h1>
        </div>
        {context && <div className="page-bar-context">{context}</div>}
        {actions && <div className="page-bar-actions">{actions}</div>}
      </div>
      {(tabs || tabsRight) && (
        <div className="page-bar-tabs">
          {tabs}
          {tabsRight && <div className="page-bar-tabs-right">{tabsRight}</div>}
        </div>
      )}
    </header>
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

/**
 * One card of a KPI band: a neutral 36px icon chip and the title (15/22),
 * with `badge` at the far end of that row; the figure (30/38) with `aside`
 * at the end of its line; then `children` on the card's floor -- a bar, a
 * sparkline. Named by its title for assistive technology.
 */
export function KpiCard({ icon: Icon, title, figure, aside, badge, className = '', children, ...rest }) {
  const titleId = useId()
  return (
    <section className={`kpi-card ${className}`.trim()} aria-labelledby={titleId} {...rest}>
      <div className="kpi-card-head">
        {Icon && (
          <span className="kpi-card-chip" aria-hidden="true">
            <Icon size={20} strokeWidth={1.9} />
          </span>
        )}
        <span className="kpi-card-title" id={titleId}>{title}</span>
        {badge && <span className="kpi-card-badge">{badge}</span>}
      </div>
      <div className="kpi-card-line">
        <span className="kpi-card-figure tnum">{figure}</span>
        {aside && <span className="kpi-card-aside">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * A share of a whole on the plain track, with an optional 2px ink tick
 * (where an even pace would have it by today). `value` and `tick` are 0-100;
 * the fill is capped at the track.
 */
export function Meter({ value, tick, label, className = '' }) {
  const at = (v) => `${Math.max(0, Math.min(100, v))}%`
  return (
    <span
      className={`meter ${className}`.trim()}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <i className="meter-fill" style={{ width: at(value) }} />
      {tick != null && <i className="meter-tick" data-testid="meter-tick" style={{ left: at(tick) }} />}
    </span>
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
