import { useEffect, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { ScopeMenu } from '../../drivetest/Toolbar'

/**
 * The page's scope: which province and which contractor every card counts.
 * Two buttons in the PageBar's context slot, the Drive test dashboard's
 * ScopeMenu each, so a scope reads and works the same on both dashboards:
 * "All provinces" / "All contractors", or the picked name with a clear
 * button beside it.
 *
 * Staff only -- the page hides it for a contractor, whose scope is its own
 * company whatever it asks for. Both lists are read once, on mount.
 */
export default function ScopePicker({ scope, onChange }) {
  const [options, setOptions] = useState({ contractors: [], provinces: [] })

  useEffect(() => {
    let live = true
    Promise.all([
      api.get('/reference/contractors').then((r) => r.data).catch(() => []),
      api.get('/reference/provinces').then((r) => r.data).catch(() => []),
    ]).then(([contractors, provinces]) => live && setOptions({ contractors, provinces }))
    return () => {
      live = false
    }
  }, [])

  const nameOf = (list, id) => list.find((x) => x.id === id)?.name
  const provinceName = nameOf(options.provinces, scope.province_id)
  const contractorName = nameOf(options.contractors, scope.contractor_id)

  return (
    <div className="acc-scope">
      <ScopeMenu
        icon={<Icon name="location" size={16} />}
        what="Province"
        all="All provinces"
        options={options.provinces}
        value={scope.province_id}
        valueName={provinceName}
        onChange={(id) => onChange({ ...scope, province_id: id })}
        clearLabel={provinceName ? `Show every province again, not just ${provinceName}` : 'Show every province again'}
      />
      <ScopeMenu
        icon={<Icon name="user--multiple" size={16} />}
        what="Contractor"
        all="All contractors"
        options={options.contractors}
        value={scope.contractor_id}
        valueName={contractorName}
        onChange={(id) => onChange({ ...scope, contractor_id: id })}
        clearLabel={
          contractorName ? `Show every contractor again, not just ${contractorName}` : 'Show every contractor again'
        }
      />
    </div>
  )
}
