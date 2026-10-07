// The one header every Roles Performance tab uses.
//
// PM and Viewer: eyebrow "Roles Performance · <scope>" and a title (the month
// on Month, the "whose?" picker on Area and Performance).
// Everyone else: their initial, eyebrow "Roles Performance · <role>", their
// name as the title and a chip saying what their scope covers.
// Both: the tab control, the tab's own date control and Export.
import { FileSpreadsheet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { canCompare } from '../../../lib/roles'
import { ROLE_LABELS, tabLabel, tabsFor } from './model'

export default function PerfHeader({
  tab,
  scopeLabel,
  title,
  subtitle,
  chip,
  dateControl,
  onExport,
  exporting = false,
  exportError = '',
  search = '',
}) {
  const { user } = useAuth()
  const comparer = canCompare(user)
  const name = user?.full_name || user?.username || ''

  return (
    <header className="rp-header">
      <div className="rp-header-top">
        {!comparer && (
          <span className="rp-avatar" aria-hidden="true">
            {name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
        <div className="rp-header-text">
          <p className="rp-eyebrow">
            Roles Performance · {comparer ? scopeLabel : ROLE_LABELS[user?.role?.name] ?? ''}
          </p>
          <div className="rp-title-row">
            <h1 className="rp-title">{comparer ? title : <span dir="auto">{name}</span>}</h1>
            {!comparer && chip && <span className="rp-chip">{chip}</span>}
          </div>
          {subtitle && <p className="rp-subtitle">{subtitle}</p>}
        </div>
        <div className="rp-header-actions">
          {dateControl}
          {onExport && (
            <button
              type="button"
              className="rp-button"
              onClick={onExport}
              disabled={exporting}
            >
              <FileSpreadsheet size={16} aria-hidden="true" />
              {exporting ? 'Building…' : 'Export'}
            </button>
          )}
        </div>
      </div>
      <nav className="rp-tabs" aria-label="Roles Performance views">
        {tabsFor(user).map((key) => (
          <Link
            key={key}
            to={`/reports/kpi/${key}${key === 'area' || key === 'performance' ? search : ''}`}
            className="rp-tab"
            aria-current={key === tab ? 'page' : undefined}
          >
            {tabLabel(user, key)}
          </Link>
        ))}
      </nav>
      {exportError && <p className="rp-state rp-state-error" role="alert">{exportError}</p>}
    </header>
  )
}
