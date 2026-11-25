// Drive test › Submissions (UEP-21): DT-done villages sent to ICT HQ.
// One page, three views chosen by ?view= (Ready · Batches · Follow up). A
// coordinator who is not the owner gets the read-only layout for their own
// regions; Viewer gets the owner layout with no actions.
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import { usePageCrumb } from '../../shell/crumbs'
import * as api from './api'
import { useSummary } from './useSummary'
import BatchesView from './BatchesView'
import CoordinatorView from './CoordinatorView'
import FollowUpView from './FollowUpView'
import ReadyView from './ReadyView'
import { ImportDialog, OwnerDialog } from './dialogs'
import { viewFrom } from './format'
import { CardError, ShamsiDay, StaleBanner, Tag, ViewTiles } from './parts'
import '../../styles/work.css'
import '../../styles/submissions.css'

/** h1, owner, "Mojri data as of", and the view's one action. */
export function PageMeta({ summary, children }) {
  const readOnlyScoped = summary?.scoped
  return (
    <div className="sb-head">
      <h1>Submissions</h1>
      {readOnlyScoped && <Tag icon="view">View only</Tag>}
      <p className="sb-meta">
        {readOnlyScoped
          ? <span>{summary.regions.join(' · ') || 'Your regions'}</span>
          : (
            <span className="sb-meta-item">
              <Icon name="user" size={16} />Owner <b>{summary?.owner?.name || 'No owner'}</b>
            </span>
          )}
        <span aria-hidden="true">·</span>
        <span className="sb-meta-item">
          <Icon name="time" size={16} />Mojri data as of <ShamsiDay value={summary?.mojri.as_of} />
        </span>
      </p>
      <span className="sb-grow" />
      {children}
    </div>
  )
}

export default function Submissions() {
  const location = useLocation()
  const view = viewFrom(location.search)
  const { summary, error, load } = useSummary()
  const [dialog, setDialog] = useState(null)
  usePageCrumb('Submissions')

  // Home (and with it the rail count) reloads on every write by itself.
  const refresh = load

  const canAct = !!summary?.can_act
  const isPM = !!summary?.is_pm
  let action = null
  if (view === 'ready' && isPM) {
    action = <button type="button" className="uw-btn" onClick={() => setDialog('owner')}><Icon name="user--follow" size={16} />Change owner</button>
  } else if (view === 'batches' && canAct) {
    action = <button type="button" className="uw-btn" onClick={() => setDialog('import')}><Icon name="upload" size={16} />Import past batches</button>
  } else if (view === 'follow-up') {
    action = (
      <button type="button" className="uw-btn" onClick={() => api.download('/follow-up/excel', 'follow_up.xlsx').catch(() => {})}>
        <Icon name="download" size={16} />Export list for ICT
      </button>
    )
  }

  const scoped = summary?.scoped
  return (
    <PageFrame bar={null} className="sb-page">
      <PageMeta summary={summary}>{!scoped && action}</PageMeta>
      <StaleBanner mojri={summary?.mojri} isPM={isPM} />
      {error && !summary && <CardError message={error} onRetry={load} />}
      {scoped ? <CoordinatorView summary={summary} /> : (
        <>
          <ViewTiles view={view} summary={summary} />
          {view === 'ready' && summary && <ReadyView summary={summary} canAct={canAct} onChanged={refresh} />}
          {view === 'batches' && <BatchesView />}
          {view === 'follow-up' && (
            <FollowUpView canAct={canAct} onChanged={refresh} followUpDays={summary?.mojri.follow_up_days} />
          )}
        </>
      )}
      <OwnerDialog open={dialog === 'owner'} current={summary?.owner} onClose={() => setDialog(null)} onSaved={refresh} />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onSaved={refresh} />
    </PageFrame>
  )
}
