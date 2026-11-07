import { Link } from 'react-router-dom'
import AppTile from '../../shell/AppTile'
import { appCount, appGroupsFor, appRoute, appState } from '../../shell/appRegistry'
import { formatNumber } from '../../lib/numbers'

/**
 * A group's entries. Normally one per app. An app named in `expand` is listed
 * page by page instead -- the region landing shows Roles performance and
 * Lifecycle gaps as two apps, because they are a Regional manager's whole
 * Insights. Each page keeps its app's tile.
 */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function panelEntries(apps, expand = []) {
  return apps.flatMap((app) => {
    if (!expand.includes(app.id)) return [{ key: app.id, app, name: app.name, description: app.description, to: appRoute(app) }]
    return app.pages.map((page) => ({
      key: `${app.id}:${page.id}`,
      app,
      name: page.label,
      description: page.description || app.description,
      to: page.route,
      single: true,
    }))
  })
}

/** Every app this role may open, by group, with its pending count. Apps only:
 * dashboards and trackers are pages inside apps. */
export default function AppsPanel({ roleName, counts, expand }) {
  return (
    <aside className="ha-panel" aria-labelledby="home-apps">
      <h2 id="home-apps">Apps</h2>
      {appGroupsFor(roleName).map((group) => (
        <section key={group.id} className="ha-group" aria-label={group.label}>
          <h3>{group.label}</h3>
          {panelEntries(group.apps, expand).map((entry) => {
            const count = entry.single ? 0 : appCount(entry.app, counts)
            return (
              <Link key={entry.key} to={entry.to} state={appState(entry.app)} className="ha-app" data-app={entry.key}>
                <AppTile app={entry.app} size={36} />
                <span className="ha-app-text">
                  <span className="ha-app-name">{entry.name}</span>
                  <span className="ha-app-desc">{entry.description}</span>
                </span>
                {count > 0 && <span className="ha-pill" aria-label={`${formatNumber(count)} pending`}>{formatNumber(count)}</span>}
              </Link>
            )
          })}
        </section>
      ))}
    </aside>
  )
}
