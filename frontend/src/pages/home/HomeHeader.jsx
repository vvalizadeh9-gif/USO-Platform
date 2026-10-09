import { CircleHelp, Search } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AccountMenu from '../../components/AccountMenu'
import { initialsOf } from '../../lib/initials'
import { HELP_URL } from './links'

// Where the search pill goes. There is no cross-entity search yet, so the pill
// says what it really searches -- sites, on Work Items -- rather than promise
// villages and letters it cannot find.
const SEARCH_PATH = '/work-items'

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
}

/** The UEP mark, in the tenant's brand colour. Decorative: "UEP" beside it
 * names the product. */
function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="10" fill="var(--brand)" />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M9.5 15 A7.5 7.5 0 0 1 17 22.5" />
        <path d="M9.5 9.5 A13 13 0 0 1 22.5 22.5" strokeOpacity="0.6" />
      </g>
      <circle cx="9.5" cy="22.5" r="2.6" fill="#fff" />
    </svg>
  )
}

export default function HomeHeader({ user, logout }) {
  const navigate = useNavigate()
  const shortcut = isMac() ? '⌘K' : 'Ctrl K'

  // ⌘K / Ctrl+K opens the search from anywhere on Home.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate(SEARCH_PATH)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <header className="h-header">
      <Link to="/home" className="h-brand" aria-label="UEP Home">
        <Mark />
        <span aria-hidden="true">UEP</span>
      </Link>
      <button
        type="button"
        className="h-search"
        onClick={() => navigate(SEARCH_PATH)}
        aria-label={`Search sites (${shortcut})`}
      >
        <Search size={18} strokeWidth={2.2} aria-hidden="true" />
        <span className="label">Search sites</span>
        <kbd aria-hidden="true">{shortcut}</kbd>
      </button>
      <div className="h-tools">
        {HELP_URL && (
          <a className="h-round" href={HELP_URL} target="_blank" rel="noreferrer" aria-label="Help">
            <CircleHelp size={19} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
        <AccountMenu user={user} initials={initialsOf(user?.full_name)} logout={logout} variant="avatar" />
      </div>
    </header>
  )
}
