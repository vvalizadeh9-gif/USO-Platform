import { ChevronDown, CornerUpLeft } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from './ui'

// The small fraction of assignments a contractor genuinely can't proceed
// with (road blocked, site down, access denied...). Hands the site back to
// the coordinator/PM queue with a required reason, instead of forcing a
// pointless drive-test submission.
//
// Collapsed by default. It is the rare path, and open it took as much of the
// panel as the drive test itself — the thing the contractor came here to do.
//
// Extracted out of WorkItemDetail.jsx unchanged, so the My Drive Tests panel
// can reuse the same reason-required return flow.
export default function ReturnToCoordinatorForm({ onSubmit }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onSubmit({ reason })
    setBusy(false)
    setConfirming(false)
    setReason('')
    setOpen(false)
  }

  return (
    <div>
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CornerUpLeft size={15} />
        Can't proceed with this site?
        <ChevronDown
          size={14}
          style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div style={{ marginTop: 12, maxWidth: 480 }}>
          <div className="field">
            <label>Reason (road blocked, site down, access denied…)</label>
            <textarea
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this site can't be drive-tested right now"
            />
          </div>
          <button
            className="btn"
            disabled={reason.trim().length < 3}
            onClick={() => setConfirming(true)}
          >
            Return to coordinator
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Return this site to the coordinator?"
        message="The coordinator and PM will be notified with your reason, and this site leaves your queue until it's reassigned."
        confirmLabel="Yes, return it"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
