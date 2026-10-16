// Small pieces every work-page list shares (UEP-06 §4, §5.3).
import Icon from '../Icon'
import { isLate } from '../../lib/siteOrder'
import { useActionLog } from '../../lib/actionLog'
import { useWork } from './WorkContext'
import { formatNumber } from '../../lib/numbers'
import Select from '../Select'

/** Persian data -- a province, contractor or village name, a field note --
 * isolated and set in Vazirmatn. Renders "—" for nothing. */
export function Fa({ children, className = '' }) {
  if (children == null || children === '') return <span className="uw-none">—</span>
  return (
    <bdi dir="rtl" lang="fa" className={`uw-fa ${className}`.trim()}>
      {children}
    </bdi>
  )
}

/** "21 d" and a bar filling toward the SLA; red, and read out as late, past it.
 * `late` overrides the day count for items late against their own due date. */
/** How many SLAs the waiting bar spans. */
const WAIT_SPAN = 3

export function WaitingCell({ days, slaDays, late: lateOverride }) {
  if (days == null) {
    return (
      <span className="uw-wait">
        <span className="uw-wait-days">—</span>
        <span className="uw-wait-bar" aria-hidden="true" />
      </span>
    )
  }
  const late = lateOverride ?? isLate(days, slaDays)
  // Less red (UEP-13 §3.9): neutral up to the SLA, danger only for the part
  // beyond it. The bar spans three SLAs, with the SLA marked on the track.
  const span = slaDays ? slaDays * WAIT_SPAN : Math.max(days, 1)
  const pct = (n) => Math.min(100, (100 * Math.max(0, n)) / span)
  const within = pct(slaDays ? Math.min(days, slaDays) : days)
  const beyond = late && slaDays ? pct(days) - within : 0
  return (
    <span className={`uw-wait ${late ? 'is-late' : ''}`.trim()}>
      <span className="uw-wait-days">
        {formatNumber(days)} d{late && <span className="uw-sr-only"> late</span>}
      </span>
      <span className="uw-wait-bar" aria-hidden="true">
        <i className="uw-wait-within" style={{ width: `${within}%` }} />
        {beyond > 0 && <i className="uw-wait-beyond" style={{ width: `${beyond}%` }} />}
        {slaDays ? <b className="uw-wait-sla" style={{ left: `${pct(slaDays)}%` }} /> : null}
      </span>
    </span>
  )
}

/** Grey chips: requested technologies. */
export function TechChips({ techs }) {
  return (
    <span className="uw-chips">
      {(techs || []).map((t) => (
        <span key={t} className="uw-chip">{t}</span>
      ))}
    </span>
  )
}

/** A grey 12px pill beside a site ID ("Re-check", "DT ongoing"). */
export function Flag({ children, title }) {
  return <span className="uw-flag" title={title}>{children}</span>
}

/** The History icon button at a row's end. */
export function HistoryButton({ siteCode, onClick }) {
  return (
    <button type="button" className="uw-icon-btn" aria-label={`History of ${siteCode || 'this site'}`} onClick={onClick}>
      <Icon name="recently-viewed" size={16} />
    </button>
  )
}

/** The site ID as a button that opens its history. */
export function SiteIdButton({ siteCode, onClick, ...rest }) {
  return (
    <button type="button" className="uw-site-id" onClick={onClick} {...rest}>
      {siteCode || '—'}
    </button>
  )
}

/** The confirmation of the last action, with Undo and a dismiss. Never times
 * out; the page clears it when the step changes or a new selection starts. */
export function ActionNotice({ floating = false }) {
  const { notice, clearNotice, undo } = useWork()
  const actions = useActionLog()
  if (!notice) return null
  const action = notice.actionId ? actions.find((a) => a.id === notice.actionId) : null
  return (
    <div className={`uw-notice ${floating ? 'is-floating' : ''} ${notice.tone === 'refused' ? 'is-refused' : ''}`.trim()}>
      {notice.tone === 'done' && <Icon name="checkmark" size={16} />}
      <span className="uw-notice-text">{notice.text}</span>
      {action?.status === 'open' && (
        <button type="button" className="uw-btn uw-btn-sm" onClick={() => undo(action)}>
          <Icon name="undo" size={16} /> Undo
        </button>
      )}
      <button type="button" className="uw-icon-btn" aria-label="Dismiss message" onClick={clearNotice}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/** "Nothing here right now", centred in the card. */
export function EmptyStep({ stepName }) {
  return (
    <div className="uw-state">
      <span className="uw-state-icon"><Icon name="checkmark--filled" size={20} /></span>
      <b>Nothing here right now</b>
      <span>Sites appear in {stepName} as soon as they reach this step.</span>
    </div>
  )
}

/** "Couldn't load {step}." with Retry, inside the card. */
export function StepError({ stepName, onRetry }) {
  return (
    <div className="uw-state" role="alert">
      <span className="uw-state-icon is-error"><Icon name="warning--alt" size={20} /></span>
      <b>Couldn't load {stepName}.</b>
      <button type="button" className="uw-btn" onClick={onRetry}>Retry</button>
    </div>
  )
}

/** Skeleton rows at their final size, in place of a spinner. */
export function SkeletonRows({ columns, rows = 8 }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="uw-skel-row">
          {Array.from({ length: columns }, (_, j) => (
            <td key={j}><span className="uw-skel" /></td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/** Home's card: a tinted tool bar (tools left, description right) over a
 * body that scrolls inside. `panelProps` make it the strip's tab panel. */
export function WorkListCard({ tools, description, children, foot, className = '', busy, ...panelProps }) {
  return (
    <section className={`uw-card ${className}`.trim()} aria-busy={busy || undefined} {...panelProps}>
      <header className="uw-card-bar">
        <div className="uw-card-tools">{tools}</div>
        {description && <p className="uw-card-desc">{description}</p>}
      </header>
      <div className="uw-card-body">{children}</div>
      {foot}
    </section>
  )
}

/** The search box every list's tool bar starts with. */
export function SearchBox({ value, onChange, label = 'Search site ID', placeholder = 'Search site ID…' }) {
  return (
    <label className="uw-search">
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** A select in the tool bar, 34px like every control. */
export function ToolSelect({ label, value, onChange, options, allLabel }) {
  return (
    <Select className="uw-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </Select>
  )
}

/** A pressed/unpressed toggle in the tool bar. */
export function ToolToggle({ pressed, onChange, children }) {
  return (
    <button type="button" className="uw-toggle" aria-pressed={pressed} onClick={() => onChange(!pressed)}>
      {children}
    </button>
  )
}
