import { Paperclip, Radio } from './carbon'
import { useRef, useState } from 'react'
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

  // The date and the report go in one request (UEP-24 F3): the caller sends
  // them through lib/driveTestSubmit, and the server refuses a drive test
  // with no report, so nothing reaches review empty.
  const submit = async () => {
    setBusy(true)
    try {
      const created = await onSubmit({ execution_date: date, files })
      if (created) setFiles([])
    } catch (err) {
      toast.error('Drive test not submitted', err.response?.data?.detail || 'Check the date and the report, then submit again.')
    } finally {
      setBusy(false)
    }
  }

  const dayDelta = daysBetween(today, date)
  const unusualDate = dayDelta !== null && (dayDelta < 0 || dayDelta > 60)

  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 4, color: 'var(--uep-accent)' }}>
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
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ padding: '11px 22px', marginTop: 4 }}
        disabled={!date || !files.length || busy}
        onClick={submit}
      >
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>

      {footer && <div className="card-foot">{footer}</div>}
    </div>
  )
}
