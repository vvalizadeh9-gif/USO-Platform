import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer } from '../../components/ui'
import { allVisibleItems, appsFor } from '../../lib/nav'
import HomeIcon from './homeIcons'

/** "HC assignment 224 + HC review 6": what a badge adds up. */
function badgeTitle(badge) {
  return (badge?.parts || []).map((p) => `${p.label} ${p.count}`).join(' + ')
}

/**
 * Every app this person can open, grouped by what they go there to do. The
 * list and who sees it come from lib/nav.js, so this panel and the sidebar on
 * every other page cannot disagree. A badge counts what is waiting on them
 * there, from the same tickets as the cards; its tooltip says which.
 */
export default function AppsPanel({ roleName, badges = {} }) {
  const [browsing, setBrowsing] = useState(false)
  const groups = appsFor(roleName)
  return (
    <aside className="h-card h-apps" aria-labelledby="home-apps">
      <h2 id="home-apps">Apps</h2>
      {groups.map((group) => (
        <nav key={group.key} aria-label={group.label} data-group={group.key}>
          <div className="h-gh" aria-hidden="true">{group.label}</div>
          {group.apps.map((app) => {
            const badge = badges?.[app.to]
            const count = badge?.count || 0
            return (
              <Link
                key={app.to}
                to={app.to}
                className="h-ap"
                aria-label={count ? `${app.label}, ${count} waiting: ${badgeTitle(badge)}` : app.label}
              >
                <span className="h-app-tile" aria-hidden="true">
                  <HomeIcon name={app.glyph} size={20} tone="white" />
                </span>
                <span aria-hidden="true">{app.label}</span>
                {count > 0 && (
                  <span className="h-badge" title={badgeTitle(badge)} aria-hidden="true">
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      ))}
      <span className="h-spacer" />
      <button type="button" className="h-browse" onClick={() => setBrowsing(true)}>
        Browse all apps
        <ArrowRight size={15} aria-hidden="true" />
      </button>
      <Drawer open={browsing} onClose={() => setBrowsing(false)} title="All apps">
        {allVisibleItems(roleName).map((section) => (
          <div key={section.label} className="h-all-section">
            <h3>{section.label}</h3>
            {section.items.map((item) => (
              <Link key={item.to} to={item.to}>{item.app?.label || item.label}</Link>
            ))}
          </div>
        ))}
      </Drawer>
    </aside>
  )
}
