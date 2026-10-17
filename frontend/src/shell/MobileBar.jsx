import { NavLink } from 'react-router-dom'
import Icon from '../components/Icon'
import { appRoute, appState } from './appRegistry'

/** Open the header search (it listens for Ctrl+K). */
function openSearch() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
}

/**
 * Below 768px the app rail becomes this bottom bar (UEP-13 §3.15): up to four
 * items -- Home · Drive test · Filing · Search -- 56px plus the safe-area
 * inset, the active item in accent. Hidden on wider screens by CSS.
 */
export default function MobileBar({ apps, hasHome }) {
  const driveTest = apps.find((a) => a.id === 'drive-test')
  const acceptance = apps.find((a) => a.id === 'acceptance')
  const filing = acceptance?.pages.find((p) => p.id === 'filing')
  const items = [
    hasHome && { key: 'home', label: 'Home', icon: 'home', to: '/home' },
    driveTest && { key: 'dt', label: 'Drive test', icon: 'cell-tower', to: appRoute(driveTest), state: appState(driveTest) },
    filing && { key: 'filing', label: 'Filing', icon: 'certificate--check', to: filing.route, state: appState(acceptance) },
  ].filter(Boolean)
  return (
    <nav className="uep-mobile-bar" aria-label="Main">
      {items.slice(0, 3).map((item) => (
        <NavLink key={item.key} to={item.to} state={item.state} className="uep-mobile-item">
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button type="button" className="uep-mobile-item" onClick={openSearch}>
        <Icon name="search" size={20} />
        <span>Search</span>
      </button>
    </nav>
  )
}
