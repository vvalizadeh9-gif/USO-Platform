// Small pieces every work-page list shares (UEP-06 §4, §5.3).
import { useEffect, useRef, useState } from 'react'
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

/** "21 d", tabular; red past the step's SLA, and read out as late (UEP-31
 * §1.6). `late` overrides the day count for items late against their own
 * due date. */
export function WaitingCell({ days, slaDays, late: lateOverride }) {
  if (days == null) return <span className="uw-none">—</span>
  const late = lateOverride ?? isLate(days, slaDays)
  return (
    <span className={`uw-days ${late ? 'is-late' : ''}`.trim()}>
      {formatNumber(Math.floor(days))} d{late && <span className="uw-sr-only"> late</span>}
    </span>
  )
}

/**
 * A site's villages as a number (UEP-31 §1.5); a click opens their names.
 * "N new" follows when CPM added villages since the site's drive test. Esc, a
 * click outside or a second click closes the list; focus stays on the button.
 * The click never reaches the row, so it does not tick it.
 */
export function VillageCount({ villages }) {
  const list = villages || []
  const [at, setAt] = useState(null)
  const buttonRef = useRef(null)
  const popRef = useRef(null)
  const fresh = list.filter((v) => v.is_new).length
  const open = at !== null

  useEffect(() => {
    if (!open) return undefined
    const close = () => setAt(null)
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      buttonRef.current?.focus()
    }
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (list.length === 0) return <span className="uw-none">—</span>
  const toggle = (e) => {
    e.stopPropagation()
    if (open) return setAt(null)
    const r = buttonRef.current.getBoundingClientRect()
    setAt({ top: r.bottom + 4, left: r.left })
  }
  const count = list.length
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="uw-vcount"
        aria-expanded={open}
        aria-label={`${formatNumber(count)} ${count === 1 ? 'village' : 'villages'}${fresh ? `, ${formatNumber(fresh)} new` : ''}, show names`}
        onClick={toggle}
      >
        {formatNumber(count)}
        {fresh > 0 && <span className="uw-vcount-new">{formatNumber(fresh)} new</span>}
        <Icon name="chevron--down" size={14} />
      </button>
      {open && (
        <div ref={popRef} className="uw-vpop" style={at} onClick={(e) => e.stopPropagation()}>
          <span className="uw-vpop-head">{formatNumber(count)} {count === 1 ? 'village' : 'villages'}</span>
          <ul>
            {list.map((v) => (
              <li key={v.id}>
                <Fa>{v.name}</Fa>
                <span className="uw-vpop-code">{v.code || v.id}{v.is_new && ' · New in CPM'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/** A header that sorts its column, with aria-sort and an accent arrow. */
export function SortHeader({ id, label, sort, onSort }) {
  const active = sort.key === id
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`uw-sort ${active ? 'is-active' : ''}`.trim()} onClick={() => onSort(id)}>
        {label}
        {active && <Icon name={sort.dir === 'asc' ? 'arrow--up' : 'arrow--down'} size={16} />}
      </button>
    </th>
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

/** "All clear" and one plain sentence, centred in the card (UEP-14 §3.7). */
export function EmptyStep({ stepName, text }) {
  return (
    <div className="uw-state">
      <span className="uw-state-icon is-clear"><Icon name="checkmark--outline" size={20} /></span>
      <b>All clear</b>
      <span>{text || `Nothing waiting in ${stepName}.`}</span>
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

/** Home's card: it starts with its tool bar (tools left, description right)
 * over a body that scrolls inside (UEP-31 §1.4: no stage strip). `panelProps`
 * make it the strip's tab panel. */
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
