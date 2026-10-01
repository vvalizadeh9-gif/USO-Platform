import { Check, X } from 'lucide-react'

/** "Sent ICT for سرآسیاب" with Undo, while the send is still held. The ×
 * sends it now rather than dropping it. */
export default function UndoToast({ entry, onUndo, onSendNow }) {
  if (!entry) return null
  return (
    <div className="mw-toast" role="status" aria-live="polite">
      <Check size={18} strokeWidth={2.5} aria-hidden="true" />
      <span className="mw-grow" dir="auto">{entry.text}</span>
      <button type="button" className="btn btn-sm mw-toast-undo" onClick={() => onUndo(entry.id)} disabled={entry.sending}>
        Undo
      </button>
      <button type="button" className="mw-icon-btn" aria-label="Dismiss" onClick={() => onSendNow(entry.id)} disabled={entry.sending}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
