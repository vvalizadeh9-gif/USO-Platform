import { NavLink } from 'react-router-dom'
import Icon from './Icon'

/**
 * The one page header (UEP-13 §3.5), used by every routed page:
 *
 *   [Title] [count]  [filters…]                 [freshness] [refresh] [actions…]
 *   [tabs (optional)]
 *
 * A white band with a bottom border, fixed at 64px, or 104px with a tab row
 * (40px), so switching tabs never moves anything. No eyebrow and no helper
 * text: the header breadcrumb names the app.
 *
 * - `title`: sentence case.
 * - `count`: a node, e.g. <HeaderCount waiting={224} late={26} />.
 * - `filters`: scope controls (pickers, month, segmented filters).
 * - `freshness`: { at, label?, onRefresh?, refreshing? }.
 * - `actions`: secondary buttons; Export goes last.
 * - `tabs`: [{ id, label, count?, to }] drawn as links, or any node (a
 *   <Tabs> row) when the page drives its own; `tabsEnd` sits at the far end
 *   of the tab row.
 */
export default function PageHeader({ title, count, filters, freshness, actions, tabs, tabsEnd, headingRef }) {
  const hasTabs = Boolean(tabs || tabsEnd)
  return (
    <header className={`uep-page-header ${hasTabs ? 'has-tabs' : ''}`.trim()} data-testid="page-header">
      <div className="uep-page-header-row">
        <h1 className="uep-page-header-title" ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title}
        </h1>
        {count != null && count !== false && <span className="uep-page-header-count">{count}</span>}
        {filters && <div className="uep-page-header-filters">{filters}</div>}
        <div className="uep-page-header-end">
          {freshness && <Freshness {...freshness} />}
          {actions}
        </div>
      </div>
      {hasTabs && (
        <div className="uep-page-header-tabs">
          {Array.isArray(tabs) ? <LinkTabs tabs={tabs} /> : tabs}
          {tabsEnd && <div className="uep-page-header-tabs-end">{tabsEnd}</div>}
        </div>
      )}
    </header>
  )
}

/** "224 waiting · 26 late": late in danger ink, only when above zero. */
export function HeaderCount({ waiting, late, noun = 'waiting' }) {
  if (waiting == null) return null
  return (
    <>
      <b className="tnum">{waiting.toLocaleString('en-US')}</b> {noun}
      {late > 0 && (
        <>
          {' · '}
          <b className="uep-page-header-late tnum">{late.toLocaleString('en-US')} late</b>
        </>
      )}
    </>
  )
}

function Freshness({ at, label, onRefresh, refreshing }) {
  return (
    <>
      {label && (
        <span className="uep-page-header-fresh" title={at ? new Date(at).toLocaleString() : undefined}>
          {label}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          className="uep-page-header-btn"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing || undefined}
          aria-label="Refresh"
        >
          <Icon name="renew" size={16} />
        </button>
      )}
    </>
  )
}

function LinkTabs({ tabs }) {
  return (
    <nav className="uep-page-header-linktabs" aria-label="Views">
      {tabs.map((tab) => (
        <NavLink key={tab.id} to={tab.to} end className="uep-page-header-linktab">
          {tab.label}
          {tab.count > 0 && <span className="ui-tab-count tnum">{tab.count}</span>}
        </NavLink>
      ))}
    </nav>
  )
}
