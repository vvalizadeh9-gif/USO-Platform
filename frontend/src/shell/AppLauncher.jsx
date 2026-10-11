import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppTile from './AppTile'
import { HOME_APP, appRoute } from './appRegistry'
import { usePopover } from './usePopover'

const COLUMNS = 4
const MOVES = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }

/** Where an arrow key moves focus in the 4-column grid; it stops at the edges. */
// eslint-disable-next-line react-refresh/only-export-components
export function nextTileIndex(index, key, count) {
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (!(key in MOVES)) return index
  const next = index + MOVES[key]
  return next < 0 || next >= count ? index : next
}

/** The app launcher: Home first, then the role's apps, filterable. */
export default function AppLauncher({ apps, onClose, openerRef }) {
  const [query, setQuery] = useState('')
  const ref = usePopover(onClose, openerRef)
  const tiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [HOME_APP, ...apps].filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    )
  }, [apps, query])

  const onGridKey = (e) => {
    const links = [...e.currentTarget.querySelectorAll('a')]
    const index = links.indexOf(document.activeElement)
    if (index < 0) return
    const next = nextTileIndex(index, e.key, links.length)
    if (next !== index) {
      e.preventDefault()
      links[next].focus()
    }
  }

  return (
    <>
      <div className="uep-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="uep-pop uep-launcher" role="dialog" aria-modal="true" aria-label="Apps">
        <input
          className="uep-field"
          type="search"
          placeholder="Find an app"
          aria-label="Find an app"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="uep-launcher-label" id="launcher-your-apps">Your apps</div>
        <div className="uep-launcher-grid" aria-labelledby="launcher-your-apps" onKeyDown={onGridKey}>
          {tiles.map((app) => (
            <Link key={app.id} to={appRoute(app)} className="uep-launcher-tile" onClick={onClose}>
              <AppTile app={app} size={40} />
              <span>{app.name}</span>
            </Link>
          ))}
          {tiles.length === 0 && <p className="uep-launcher-none">No app matches that.</p>}
        </div>
        <div className="uep-launcher-foot">
          <span>Showing apps for your role</span>
          <Link to="/home" onClick={onClose}>All apps</Link>
        </div>
      </div>
    </>
  )
}
