import { Link } from 'react-router-dom'
import AppTile from '../../shell/AppTile'
import { appCount, appGroupsFor, appRoute, appState } from '../../shell/appRegistry'
import { formatNumber } from '../../lib/numbers'

/** Every app this role may open, by group, with its pending count. Apps only:
 * dashboards and trackers are pages inside apps. */
export default function AppsPanel({ roleName, counts }) {
  return (
    <aside className="ha-panel" aria-labelledby="home-apps">
      <h2 id="home-apps">Apps</h2>
      {appGroupsFor(roleName).map((group) => (
        <section key={group.id} className="ha-group" aria-label={group.label}>
          <h3>{group.label}</h3>
          {group.apps.map((app) => {
            const count = appCount(app, counts)
            return (
              <Link key={app.id} to={appRoute(app)} state={appState(app)} className="ha-app" data-app={app.id}>
                <AppTile app={app} size={36} />
                <span className="ha-app-text">
                  <span className="ha-app-name">{app.name}</span>
                  <span className="ha-app-desc">{app.description}</span>
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
