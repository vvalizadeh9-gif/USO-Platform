import { useState } from 'react'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import PageHeader from '../../components/PageHeader'
import { Tabs } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { FEATURE, can } from '../../lib/access'
import ImportFlow from './dataImport/ImportFlow'
import HistoryList from './dataImport/HistoryList'
import '../../styles/data-import.css'

/**
 * Admin › Data import (UEP-29): load drive test and acceptance data from
 * Excel, review every change and conflict before anything is saved, and undo
 * any upload. One screen, two tabs; lists scroll inside their panels. The
 * server re-checks the `data_import` feature on every call: View reads the
 * history, Edit does everything else.
 */
export default function DataImportTab() {
  const { user } = useAuth()
  const canEdit = can(user, FEATURE.DATA_IMPORT, 'edit')
  const [tab, setTab] = useState(canEdit ? 'import' : 'history')
  const [historyKey, setHistoryKey] = useState(0)

  const tabs = [
    ...(canEdit ? [{ key: 'import', label: 'Import' }] : []),
    { key: 'history', label: 'History' },
  ]
  const header = (
    <PageHeader
      title={<><span className="di-title-tile" aria-hidden="true"><Icon name="cloud--upload" size={20} /></span>Data import</>}
      tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} label="Data import" panelId="di-panel" />}
    />
  )

  return (
    <PageFrame bar={header} className="di-page">
      <div id="di-panel" role="tabpanel" className="di-panel" key={tab}>
        {tab === 'import' && canEdit && (
          <ImportFlow
            onShowHistory={() => { setHistoryKey((k) => k + 1); setTab('history') }}
          />
        )}
        {tab === 'history' && <HistoryList key={historyKey} canEdit={canEdit} />}
      </div>
    </PageFrame>
  )
}
