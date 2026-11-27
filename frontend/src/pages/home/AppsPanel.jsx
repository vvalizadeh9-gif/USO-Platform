import { useId } from 'react'
import { Link } from 'react-router-dom'
import AppTile from '../../shell/AppTile'
import { appCount, appGroupsFor, appRoute, appState } from '../../shell/appRegistry'
import { formatNumber } from '../../lib/numbers'
import { compactCount } from './homeLogic'

/** The grid's columns: a group spans as many as it has apps, so small groups
 * share a row (Planning + Insights). */
export const GRID_COLUMNS = 3

/** Platform apps draw as quiet white tiles: they are not where work is. */
const QUIET_APPS = new Set(['data', 'admin'])

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

function AppEntry({ entry, count, onOpenBadge, index }) {
  const descId = useId()
  return (
    <div className="ha-tile-wrap" style={{ '--a': index }}>
      <Link
        to={entry.to}
        state={appState(entry.app)}
        className={`ha-app${QUIET_APPS.has(entry.app.id) ? ' is-quiet' : ''}`}
        data-app={entry.key}
        data-tip={entry.description}
        aria-describedby={descId}
      >
        <AppTile app={entry.app} size={40} />
        <span className="ha-app-name">{entry.name}</span>
        <span id={descId} className="sr-only">{entry.description}</span>
      </Link>
      {count > 0 && (
        <button
          type="button"
          className="ha-badge"
          data-testid={`badge-${entry.key}`}
          aria-label={`${entry.name}: ${formatNumber(count)} pending, show list`}
          onClick={(e) => onOpenBadge?.(entry.app, e.currentTarget)}
        >
          <span className="ha-badge-dot">{compactCount(count)}</span>
        </button>
      )}
    </div>
  )
}

/** Every app this user may open, as a tile grid by group, each with its
 * pending count (UEP-27 §4.3). A count opens the app's to-do summary. */
export default function AppsPanel({ user, counts, expand, onOpenBadge }) {
  let index = 0
  return (
    <aside className="ha-panel" aria-labelledby="home-apps">
      <h2 id="home-apps">Apps</h2>
      <div className="ha-grid">
        {appGroupsFor(user).map((group) => {
          const entries = panelEntries(group.apps, expand)
          const span = Math.min(entries.length, GRID_COLUMNS)
          return (
            <section
              key={group.id}
              className="ha-group"
              aria-label={group.label}
              data-group={group.id}
              style={{ gridColumn: `span ${span}`, '--n': span }}
            >
              <h3>{group.label}</h3>
              <div className="ha-tiles">
                {entries.map((entry) => (
                  <AppEntry
                    key={entry.key}
                    entry={entry}
                    index={index++}
                    count={entry.single ? 0 : appCount(entry.app, counts)}
                    onOpenBadge={onOpenBadge}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
