import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer } from '../../components/ui'
import { allVisibleItems, appsFor } from '../../lib/nav'

/**
 * Every app this person can open, grouped by what they go there to do. The
 * list and who sees it come from lib/nav.js, so this panel and the sidebar on
 * every other page cannot disagree. A black badge counts what is waiting on
 * them there, from the same tickets as the cards.
 */
export default function AppsPanel({ roleName, badges = {} }) {
  const [browsing, setBrowsing] = useState(false)
  const groups = appsFor(roleName)
  return (
    <aside className="h-card h-apps" aria-labelledby="home-apps">
      <h2 id="home-apps">Apps</h2>
      {groups.map((group) => (
        <nav key={group.key} aria-label={group.label}>
          <div className="h-gh" aria-hidden="true">{group.label}</div>
          {group.apps.map((app) => {
            const count = badges[app.to] || 0
            const Icon = app.icon
            return (
              <Link
                key={app.to}
                to={app.to}
                className="h-ap"
                aria-label={count ? `${app.label}, ${count} waiting` : app.label}
              >
                <span className="h-icon" data-tint={app.tint} aria-hidden="true">
                  {Icon && <Icon size={17} strokeWidth={2} />}
                </span>
                <span aria-hidden="true">{app.label}</span>
                {count > 0 && <span className="h-badge" aria-hidden="true">{count}</span>}
              </Link>
            )
          })}
        </nav>
      ))}
      <span className="h-spacer" />
      <button type="button" className="h-browse" onClick={() => setBrowsing(true)}>
        Browse all apps
        <ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
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
