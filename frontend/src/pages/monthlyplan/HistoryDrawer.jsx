import { X } from 'lucide-react'
import { useEffect } from 'react'
import Revisions from './Revisions'
import { STREAMS } from './streams'

/**
 * Every version of one contractor's plans for one month, every stream, in a
 * right-side panel. Read-only: decisions are made on the Plans tab itself.
 * Each stream is the existing Revisions panel (GET /pip/revisions).
 */
export default function HistoryDrawer({ contractor, period, label, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const target = { year: period.year, month: period.month, contractorId: contractor.id }
  return (
    <>
      <div className="mp-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="mp-drawer" role="dialog" aria-label="Plan history">
        <div className="mp-drawer-head">
          <div>
            <div className="mp-drawer-title">{contractor.name}</div>
            <div className="dim" style={{ fontSize: 'var(--fs-meta)' }}>Plan history · {label}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="mp-drawer-body">
          {STREAMS.map((stream) => (
            <Revisions key={stream} period={target} stream={stream} isContractor={false} onClose={onClose} />
          ))}
        </div>
      </aside>
    </>
  )
}
