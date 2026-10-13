import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useFillPage } from '../../../components/pageMode'
import AreaTab from './AreaTab'
import MapTab from './MapTab'
import MonthTab from './MonthTab'
import { landingTab, tabSearch, tabsFor } from './model'
import './rolesPerformance.css'

/**
 * Performance → Roles Performance: the page about people.
 *
 *   Month  what happened in a month, and who it belongs to (PM, Viewer)
 *   Area   where things stand today, against national ("My area" for others)
 *   Map    the Lifecycle Gaps coverage map, unchanged
 *
 * The tabs a role sees are decided here; the numbers a role may see are
 * decided by the server, which refuses anything else with a 403. Area carries
 * the chosen scope in the URL (?lens=&key=), so a Month owner can open their
 * own Area and the link can be shared. Any other tab -- including the old
 * /performance and /compare bookmarks -- lands on the role's own first tab,
 * keeping the scope.
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
    const landing = landingTab(user)
    return <Navigate to={`/reports/kpi/${landing}${tabSearch('area', search)}`} replace />
  }

  const lens = search.get('lens')
  const key = search.get('key')
  const scope = lens && lens !== 'country' ? { lens, key } : null
  const setScope = (next) => {
    const params = new URLSearchParams(search)
    params.delete('lens')
    params.delete('key')
    if (next) {
      params.set('lens', next.lens)
      params.set('key', next.key)
    }
    setSearch(params)
  }
  const openOwner = (next) =>
    navigate(`/reports/kpi/area?${new URLSearchParams(next).toString()}`)
  const query = search.toString() ? `?${search.toString()}` : ''

  const Body = { month: MonthTab, area: AreaTab, map: MapTab }[tab]

  return (
    <div className="rp">
      <Body scope={scope} onScope={setScope} onOpenOwner={openOwner} search={query} />
    </div>
  )
}
