import { useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useDialogFocus } from '../../components/useDialogFocus'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { FEATURE, can } from '../../lib/access'
import { formatGregorian } from '../../lib/dates'
import { describeBlobError, saveBlob } from '../../lib/download'
import { decisionLine } from './explorerModel'
import VillageChip from './VillageChip'

const KIND = {
  added: { icon: 'add', title: 'Village added' },
  removed: { icon: 'subtract', title: 'Village removed' },
}

function HistoryEvent({ event, index }) {
  const kind = KIND[event.kind]
  const struck = event.kind === 'removed' && event.status === 'applied'
  return (
    <li className={`exh-event is-${event.kind} is-${event.status}`} style={{ '--exh-i': index }}>
      <span className="exh-dot" aria-hidden="true"><Icon name={kind.icon} size={16} /></span>
      <div className="exh-body">
        <div className="exh-line">
          <b>{kind.title}</b>
          <span>CPM import · {formatGregorian(event.date) || '—'}</span>
        </div>
        <div className="exh-chips">
          {event.villages.map((v) => <VillageChip key={v.code ?? v.name} village={v} struck={struck} />)}
        </div>
        <span className="exh-status">{decisionLine(event)}</span>
      </div>
    </li>
  )
}

/**
 * The record's village history (UEP-28 §B6): a right-side panel with the
 * current villages and every village a CPM import added or removed, newest
 * first. Focus is trapped while it is open; Esc closes it and focus goes back
 * to whatever opened it. Export to Excel is offered with the Exports feature.
 */
export default function VillageHistoryPanel({ open, onClose, record }) {
  const panelRef = useRef(null)
  const { user } = useAuth()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  useDialogFocus(open, panelRef, onClose)
  if (!open || !record) return null

  const villages = record.villages
  const history = record.village_history || []
  const exportHistory = async () => {
    setExporting(true)
    try {
      const res = await api.get(`/explorer/sites/${record.id}/villages/export`, { responseType: 'blob' })
      saveBlob(res.data, `${record.site_code || record.id}_villages.xlsx`)
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="exh-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="exh" role="dialog" aria-modal="true" aria-labelledby="exh-title" tabIndex={-1}>
        <header className="exh-head">
          <div className="exh-head-text">
            <h2 id="exh-title">Villages</h2>
            <span className="exh-sub">
              {record.site_code} · {villages.length} target {villages.length === 1 ? 'village' : 'villages'}
            </span>
          </div>
          {can(user, FEATURE.EXPORTS) && (
            <button type="button" className="uw-btn uw-btn-sm" onClick={exportHistory} disabled={exporting} aria-busy={exporting || undefined}>
              <Icon name="download" size={16} /> Export to Excel
            </button>
          )}
          <button type="button" className="exh-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="exh-scroll">
          <h3 className="exh-section">Current villages</h3>
          {villages.length ? (
            <div className="exh-chips">{villages.map((v) => <VillageChip key={v.id ?? v.code} village={v} />)}</div>
          ) : <p className="exh-empty">No target villages.</p>}
          <h3 className="exh-section">History</h3>
          {history.length ? (
            <ol className="exh-events">
              {history.map((e, i) => <HistoryEvent key={`${e.date}-${e.kind}-${i}`} event={e} index={i} />)}
            </ol>
          ) : <p className="exh-empty">No CPM import has added or removed a village on this site.</p>}
        </div>
      </aside>
    </>
  )
}
