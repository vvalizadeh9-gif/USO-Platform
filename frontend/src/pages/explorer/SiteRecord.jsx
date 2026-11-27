import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFillPage } from '../../components/pageMode'
import { useAuth } from '../../context/AuthContext'
import NoAccess from '../../components/NoAccess'
import { AREA, canAccess } from '../../lib/access'
import { canFileAcceptance } from '../../lib/roles'
import { hasAnyAction, workflowActions } from './explorerModel'
import JourneyCard from './JourneyCard'
import RecordHeader from './RecordHeader'
import SitePassport from './SitePassport'
import TakeActionDrawer from './TakeActionDrawer'
import useSiteRecord from './useSiteRecord'
import VillageHistoryPanel from './VillageHistoryPanel'
import '../../styles/home.css'
import '../../styles/work.css'
import '../../styles/explorer.css'

/**
 * Explorer's site record page (UEP-28 Part B), top to bottom: the header, the
 * site passport, and the Journey card (its numbers, the timeline ribbon and
 * acceptance by village). One read, GET /explorer/sites/{id}.
 *
 * Fills the height under the shell: at 1440×900 and 1366×768 the page never
 * scrolls; only the village table's body (and the history panel) do.
 */
export default function SiteRecord() {
  useFillPage()
  const { workItemId } = useParams()
  const [params] = useSearchParams()
  const linked = params.get('village')
  const { user } = useAuth()
  const { status, data, retry, reload } = useSiteRecord(workItemId)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // ?village= highlights a row; a passport chip moves or clears it.
  const [highlight, setHighlight] = useState(linked)
  useEffect(() => setHighlight(linked), [linked])
  const headingRef = useRef(null)

  const role = user?.role?.name
  const actions = workflowActions(user, data?.workflow)
  const siteLabel = data?.site_code || `Site #${workItemId}`

  if (status === 'forbidden') return <NoAccess />

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
        canFile={canFileAcceptance(user)}
        canOpenMyWork={canAccess(user, AREA.ACCEPTANCE_WORKSPACE)}
        isContractor={role === 'Contractor'}
        onTakeAction={hasAnyAction(actions) ? () => setDrawerOpen(true) : undefined}
      />
      <SitePassport
        record={data}
        status={status}
        onRetry={retry}
        highlight={highlight}
        onHighlight={setHighlight}
        onHistory={() => setHistoryOpen(true)}
      />
      <JourneyCard record={data} status={status} onRetry={retry} highlight={highlight} />
      <VillageHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} record={data} />
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
