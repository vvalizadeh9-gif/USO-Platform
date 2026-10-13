// The one header every Roles Performance tab uses: the shared PageBar.
//
// PM and Viewer: eyebrow "Roles Performance · <scope>" and a title (the month
// picker on Month, the "whose?" picker on Area, "Map" on Map).
// Everyone else: eyebrow "Roles Performance · <role>", their name as the
// title and a chip saying what their scope covers.
// Both: a subtitle, Export, and the tabs.
import { useNavigate } from 'react-router-dom'
import Icon from '../../../components/Icon'
import { PageBar, Tabs } from '../../../components/ui'
import { useAuth } from '../../../context/AuthContext'
import { canCompare } from '../../../lib/roles'
import { ROLE_LABELS, tabLabel, tabSearch, tabsFor } from './model'

export default function PerfHeader({
  tab,
  scopeLabel,
  title,
  subtitle,
  chip,
  onExport,
  exporting = false,
  search = '',
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const comparer = canCompare(user)
  const name = user?.full_name || user?.username || ''

  const heading = comparer ? title : (
    <span className="rp-own-title">
      <span dir="auto">{name}</span>
      {chip && <span className="rp-chip">{chip}</span>}
    </span>
  )

  return (
    <PageBar
      eyebrow={`Roles Performance · ${comparer ? scopeLabel : ROLE_LABELS[user?.role?.name] ?? ''}`}
      title={heading}
      subtitle={subtitle}
      actions={onExport && (
        <button type="button" className="rp-button" onClick={onExport} disabled={exporting}>
          <Icon name="download" size={16} />
          {exporting ? 'Building…' : 'Export'}
        </button>
      )}
      tabs={
        <Tabs
          tabs={tabsFor(user).map((key) => ({ key, label: tabLabel(user, key) }))}
          value={tab}
          onChange={(key) => navigate(`/reports/kpi/${key}${tabSearch(key, search)}`)}
          label="Roles Performance views"
        />
      }
    />
  )
}
