import { Paperclip, Radio } from 'lucide-react'
import { useRef, useState } from 'react'
import api from '../api/client'
import { useToast } from '../context/ToastContext'
import DateField from './DateField'
import { daysBetween, todayIso } from '../lib/dates'

// Contractor records when the drive test was actually executed and attaches
// the report. A PM or Coordinator picks it up for approval; approving is what
// marks the site DT Done on the dashboard.
//
// The date field is open. It used to be capped at today with Today/Yesterday
// chips, which assumed drive tests get logged the day they happen — the
// backend never had that restriction, so the rule only ever existed in this
// form. A date far from today gets a note rather than a second hard rule: the
// contractor is the one who knows when they drove the route.
//
// Extracted out of WorkItemDetail.jsx unchanged, so the My Drive Tests panel
// can reuse the same submit + evidence-upload flow.
export default function DriveTestSubmitForm({ onSubmit, footer }) {
  const today = todayIso()
  const [date, setDate] = useState(today)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const toast = useToast()

  const submit = async () => {
    setBusy(true)
    try {
      const created = await onSubmit({ execution_date: date })
      const driveTestId = created?.drive_test_id
      if (driveTestId && files.length) {
        for (const file of files) {
          const form = new FormData()
          form.append('file', file)
          await api.post(`/drive-tests/${driveTestId}/evidence`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        }
      }
    } catch (err) {
      toast.error(
        'Report not attached',
        err.response?.data?.detail ||
          'The drive test was submitted, but the file did not upload. Open the site again to retry.',
      )
    } finally {
      setBusy(false)
      setFiles([])
    }
  }

  const dayDelta = daysBetween(today, date)
  const unusualDate = dayDelta !== null && (dayDelta < 0 || dayDelta > 60)

  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 4, color: 'var(--signal)' }}>
        <Radio size={17} />
        <h3 style={{ fontSize: 15 }}>Submit drive test</h3>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18, maxWidth: '60ch' }}>
        Record when the drive test was carried out and attach the report. A PM or
        coordinator approves it — approval is what counts the site as DT Done.
      </p>

      <div className="field-pair">
        <div className="field">
          <label htmlFor="dt-date">Date the drive test was carried out</label>
          <DateField id="dt-date" value={date} onChange={setDate} />
          {unusualDate && (
            <small className="field-warning">
              {dayDelta < 0
                ? 'That date is in the future — check it before submitting.'
                : `That is ${dayDelta} days ago. Fine if the drive test really was that long ago.`}
            </small>
          )}
        </div>

        <div className="field">
          <label>Report / measurement files</label>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <Paperclip size={14} /> Attach file
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              onChange={(e) => setFiles([...e.target.files])}
            />
            <span className="dim" style={{ fontSize: 12.5 }}>
              {files.length > 0 ? files.map((f) => f.name).join(', ') : 'No files yet'}
            </span>
          </div>
          <small className="dim" style={{ fontSize: 12 }}>
            Optional, but the reviewer approves against this.
          </small>
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ padding: '11px 22px', marginTop: 4 }}
        disabled={!date || busy}
        onClick={submit}
      >
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>

      {footer && <div className="card-foot">{footer}</div>}
    </div>
  )
}
