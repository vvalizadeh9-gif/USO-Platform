import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import AppTile from './AppTile'
import { appState, pageCount } from './appRegistry'

/** An app's own pages, with each page's pending count. No rail for an app
 * with a single page. Collapsible on narrow screens; stacks on mobile. */
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
        {app.pages.map((page) => {
          const count = pageCount(page, counts)
          const active = page.id === activePage?.id
          return (
            <Link
              key={page.id}
              to={page.route}
              state={appState(app)}
              className={`uep-rail-item ${active ? 'is-active' : ''} ${page.divider ? 'has-divider' : ''}`.trim()}
              aria-current={active ? 'page' : undefined}
            >
              <span>{page.label}</span>
              {count > 0 && <span className="uep-rail-count">{count}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
