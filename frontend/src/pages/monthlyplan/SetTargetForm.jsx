import { useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { currentShamsiPeriod } from '../../lib/shamsi'
import PeriodPicker from './PeriodPicker'
import { streamMeta } from './streams'

/**
 * The PM's own inline form for one stream's Internal PIP: which Shamsi month,
 * how many, why.
 *
 * ACCEPTANCE (villages fully accepted) is saved through PUT /acceptance/plan
 * as it always was; DT, ICT and CRA through PUT /pip/internal-target. Every
 * stream is a monthly amount.
 */
export default function SetTargetForm({ defaultValue, onClose, onSaved, stream = 'ACCEPTANCE', initialPeriod }) {
  const toast = useToast()
  const running = currentShamsiPeriod()
  const meta = streamMeta(stream)
  const unit = stream === 'DT' ? 'drive tests' : 'villages'
  const [period, setPeriod] = useState(initialPeriod || running || { year: 0, month: 0 })
  const [count, setCount] = useState(defaultValue != null ? String(defaultValue) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const parsed = () => {
    const raw = count.trim()
    if (!/^\d+$/.test(raw)) return undefined
    return Number(raw)
  }

  async function submit() {
    const value = parsed()
    if (!period?.year || !period?.month) {
      toast.error('Pick a month', 'Choose the Shamsi year and month this target is for.')
      return
    }
    if (value === undefined) {
      toast.error(`That is not a number of ${unit}`, 'Enter a whole number.')
      return
    }
    setBusy(true)
    try {
      if (stream !== 'ACCEPTANCE') {
        await api.put('/pip/internal-target', {
          stream,
          year: period.year,
          month: period.month,
          target_count: value,
          note: note.trim() || undefined,
        })
      } else {
        await api.put('/acceptance/plan', {
          shamsi_year: period.year,
          shamsi_month: period.month,
          target_count: value,
          note: note.trim() || undefined,
        })
      }
      toast.success('Target set', `Saved for ${period.year}/${period.month}.`)
      onSaved?.()
    } catch (err) {
      toast.error('Could not save the target', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="card"
      style={{
        position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, marginTop: 8,
        padding: 14, boxShadow: 'var(--shadow-1, 0 8px 24px rgba(20,35,60,0.14))',
      }}
      role="dialog"
      aria-label={stream === 'ACCEPTANCE' ? 'Set the acceptance target' : `Set the ${meta.short} Internal PIP`}
    >
      <div className="field" style={{ margin: 0, marginBottom: 10 }}>
        <label>Shamsi month</label>
        <PeriodPicker period={period} onChange={setPeriod} disabled={busy} />
      </div>
      <div className="field" style={{ margin: 0, marginBottom: 10 }}>
        <label htmlFor="acc-plan-target">Target ({unit} this month)</label>
        <input
          id="acc-plan-target"
          className="input"
          inputMode="numeric"
          value={count}
          disabled={busy}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>
      <div className="field" style={{ margin: 0, marginBottom: 12 }}>
        <label htmlFor="acc-plan-note">Note (optional)</label>
        <input
          id="acc-plan-note"
          className="input"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save target'}
        </button>
      </div>
    </div>
  )
}
