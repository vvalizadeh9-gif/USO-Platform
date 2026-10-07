import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useFillPage } from '../../../components/pageMode'
import AreaTab from './AreaTab'
import CompareTab from './CompareTab'
import MapTab from './MapTab'
import MonthTab from './MonthTab'
import PerformanceTab from './PerformanceTab'
import { landingTab, tabsFor } from './model'
import './rolesPerformance.css'

/**
 * Performance → Roles Performance: the page about people.
 *
 *   Month        what happened this month, against last month (PM, Viewer)
 *   Area         where things stand today          ("My area" for others)
 *   Performance  what one owner delivered, and how fast ("My performance")
 *   Compare      owners of one kind, ranked (PM, Viewer)
 *   Map          the Lifecycle Gaps coverage map, unchanged
 *
 * The tabs a role sees are decided here; the numbers a role may see are
 * decided by the server, which refuses anything else with a 403. Area and
 * Performance carry the chosen scope in the URL (?lens=&key=), so a Compare
 * row can open an owner in Performance and the link can be shared.
 */
export default function RolesPerformance() {
  useFillPage()
  const { user } = useAuth()
  const { tab } = useParams()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()

  const tabs = tabsFor(user)
  if (!tabs.length) return <Navigate to="/" replace />
  if (!tab || !tabs.includes(tab)) {
    return <Navigate to={`/reports/kpi/${landingTab(user)}`} replace />
  }

  const lens = search.get('lens')
  const key = search.get('key')
  const scope = lens && lens !== 'country' ? { lens, key } : null
  const setScope = (next) => setSearch(next ? { lens: next.lens, key: next.key } : {})
  const openPerformance = (next) =>
    navigate(`/reports/kpi/performance?${new URLSearchParams(next).toString()}`)
  const query = search.toString() ? `?${search.toString()}` : ''

  const Body = {
    month: MonthTab,
    area: AreaTab,
    performance: PerformanceTab,
    compare: CompareTab,
    map: MapTab,
  }[tab]

  return (
    <div className="rp">
      <Body
        scope={scope}
        onScope={setScope}
        onOpenOwner={openPerformance}
        search={query}
      />
    </div>
  )
}
