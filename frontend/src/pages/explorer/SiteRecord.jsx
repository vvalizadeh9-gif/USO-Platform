import { useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFillPage } from '../../components/pageMode'
import { useAuth } from '../../context/AuthContext'
import { canFileAcceptance } from '../../lib/roles'
import { hasAnyAction, workflowActions } from './explorerModel'
import GeneralInfoCard from './GeneralInfoCard'
import JourneyCard from './JourneyCard'
import RecordHeader from './RecordHeader'
import TakeActionDrawer from './TakeActionDrawer'
import useSiteRecord from './useSiteRecord'
import '../../styles/home.css'
import '../../styles/work.css'
import '../../styles/explorer.css'

/**
 * Explorer's site record page (UEP-11 §B3–B5): general information on the
 * left, the site's journey through UEP on the right with ICT and CRA
 * acceptance per village. One read, GET /explorer/sites/{id}.
 *
 * Fills the height under the shell; at 1440×900 nothing scrolls for up to six
 * villages, and above that only the village table's body does.
 */
export default function SiteRecord() {
  useFillPage()
  const { workItemId } = useParams()
  const [params] = useSearchParams()
  const highlight = params.get('village')
  const { user } = useAuth()
  const { status, data, retry, reload } = useSiteRecord(workItemId)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const headingRef = useRef(null)

  const role = user?.role?.name
  const actions = workflowActions(user, data?.workflow)
  const siteLabel = data?.site_code || `Site #${workItemId}`

  if (status === 'missing') {
    return (
      <div className="uep-home uw-page ex-page">
        <RecordHeader siteLabel={`Site #${workItemId}`} headingRef={headingRef} />
        <div className="hw-card ex-card ex-missing-card" role="status">
          This site was not found, or it is not one you can see.
        </div>
      </div>
    )
  }

  return (
    <div className="uep-home uw-page ex-page">
      <RecordHeader
        record={data}
        siteLabel={siteLabel}
        headingRef={headingRef}
        canFile={canFileAcceptance(role)}
        isContractor={role === 'Contractor'}
        onTakeAction={hasAnyAction(actions) ? () => setDrawerOpen(true) : undefined}
      />
      <div className="ex-cards">
        <GeneralInfoCard general={data?.general} status={status} onRetry={retry} />
        <JourneyCard record={data} status={status} onRetry={retry} highlight={highlight} />
      </div>
      {data && hasAnyAction(actions) && (
        <TakeActionDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          workItemId={data.id}
          workflow={data.workflow}
          actions={actions}
          onDone={() => {
            setDrawerOpen(false)
            reload()
          }}
        />
      )}
    </div>
  )
}
