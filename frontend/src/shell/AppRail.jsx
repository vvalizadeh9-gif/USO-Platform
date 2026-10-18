import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import AppTile from './AppTile'
import { appState, pageCount } from './appRegistry'
import { formatNumber } from '../lib/numbers'

/** An app's own pages, with each page's pending count. No rail for an app
 * with a single page. Collapsible on narrow screens; stacks on mobile.
 *
 * Every item leads with a 24px colour tile and a 16px white Carbon icon, like
 * AppTile (UEP-14 §2). Pages that name a `section` are grouped under it; a
 * section with one page (History) is that page alone. */
export default function AppRail({ app, activePage, counts }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!app || app.pages.length < 2) return null
  return (
    <aside className={`uep-rail ${collapsed ? 'is-collapsed' : ''}`.trim()} aria-label={`${app.name} pages`}>
      <div className="uep-rail-head">
        <AppTile app={app} size={28} />
        <span className="uep-rail-name">{app.name}</span>
        <button
          type="button"
          className="uep-rail-toggle"
          aria-label={collapsed ? 'Show pages' : 'Hide pages'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <Icon name="chevron--down" size={16} />
        </button>
      </div>
      <nav className="uep-rail-items">
        {app.pages.map((page, i) => {
          const count = pageCount(page, counts)
          const active = page.id === activePage?.id
          const section = page.section && page.section !== page.label && page.section !== app.pages[i - 1]?.section
          return (
            <Fragment key={page.id}>
              {section && <span className="uep-rail-section">{page.section}</span>}
              <Link
                to={page.route}
                state={appState(app)}
                className={`uep-rail-item ${active ? 'is-active' : ''} ${page.divider ? 'has-divider' : ''}`.trim()}
                aria-current={active ? 'page' : undefined}
              >
                {page.icon && (
                  <span className="uep-rail-tile" style={{ background: `var(${page.tile || app.color})` }} aria-hidden="true">
                    <Icon name={page.icon} size={16} />
                  </span>
                )}
                <span className="uep-rail-label">{page.label}</span>
                {count > 0 && <span className="uep-rail-count">{formatNumber(count)}</span>}
              </Link>
            </Fragment>
          )
        })}
      </nav>
    </aside>
  )
}
