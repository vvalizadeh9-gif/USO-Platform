// The one header every Roles performance tab uses: PageHeader, the same
// height on Month, Area and Map (UEP-13 §3.5).
//
// PM and Viewer: "Roles performance", with the month picker (Month) or the
// scope picker (Area) in the filters and the "so far" line next to it.
// Everyone else: their name as the title and a chip saying what their scope
// covers. Both: Export and the tabs.
import { useNavigate } from 'react-router-dom'
import Icon from '../../../components/Icon'
import PageHeader from '../../../components/PageHeader'
import { Tabs } from '../../../components/ui'
import { useAuth } from '../../../context/AuthContext'
import { canCompare } from '../../../lib/roles'
import { tabLabel, tabSearch, tabsFor } from './model'

export default function PerfHeader({
  tab,
  scopeLabel: _scopeLabel,
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

  // One title on every tab (UEP-13 §3.5): "Roles performance" for PM and
  // Viewer, whose month or scope picker sits in the filters with the
  // "so far" line beside it; everyone else's name and scope chip.
  const heading = comparer ? 'Roles performance' : (
    <span className="rp-own-title">
      <span dir="auto">{name}</span>
      {chip && <span className="rp-chip">{chip}</span>}
    </span>
  )
  const picker = comparer && typeof title !== 'string' ? title : null

  return (
    <PageHeader
      title={heading}
      filters={(picker || subtitle) && (
        <>
          {picker}
          {subtitle && <span className="rp-header-note">{subtitle}</span>}
        </>
      )}
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
          label="Roles performance views"
        />
      }
    />
  )
}
