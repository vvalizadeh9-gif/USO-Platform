import { ArrowDown, ArrowUp, Flag, X } from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { canSetAcceptancePlan } from '../../lib/roles'
import { currentShamsiPeriod } from '../../lib/shamsi'
import { planDeltaTone } from '../reports/acceptancePlan'
import { fmtCount } from '../reports/kpiTheme'
import PeriodPicker from './PeriodPicker'

/**
 * This month's programme-wide acceptance target, and — for a PM only — the
 * control that sets it.
 *
 * The figure is `current.target_count` from GET /acceptance/plan, never
 * fabricated: a programme with no target yet shows an explicit "not set"
 * state rather than a 0 that would read as a real, very bad, target.
 *
 * It lives on the Monthly Plan page, beside the other monthly commitments a
 * PM sets, and not on the Acceptance Dashboard: that page reports what has
 * happened, and a target is what was promised. The dashboard still reads it
 * — its Plan vs Actual chart draws the dashed "Planned" line from these same
 * stored targets, month by month (/acceptance/trends).
 *
 * It keeps the `.dt-kpi-card` shell, with the PM's control riding at the end
 * of the header row rather than in a corner of its own.
 */
export default function AcceptanceTargetCard({ plan, onSaved }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const canSet = canSetAcceptancePlan(user)

  const current = plan?.current ?? null
  const previous = plan?.previous ?? null
  const delta = current && previous ? current.target_count - previous.target_count : null
  const tone = planDeltaTone(delta)

  return (
    <div className="dt-kpi-card" data-kpi="acc-plan" style={{ position: 'relative' }}>
      <div className="dt-kpi-hd">
        <span className="dt-kpi-ic" aria-hidden="true">
          <Flag size={13} strokeWidth={2.2} />
        </span>
        <span className="dt-kpi-title">Acceptance target</span>
        {canSet && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Close set-target form' : 'Set this month’s acceptance target'}
            style={{ marginInlineStart: 'auto', flexShrink: 0, padding: '2px 7px', fontSize: 11.5 }}
          >
            {open ? <X size={13} /> : '+ Set target'}
          </button>
        )}
      </div>

      {current ? (
        <>
          <div className="dt-kpi-v">
            <span className="dt-kpi-figure tnum">{fmtCount(current.target_count)}</span>
          </div>
          <div className="dt-kpi-sub">{current.label || 'Cumulative target'}</div>
          {delta != null ? (
            <div
              className="row"
              style={{ gap: 4, fontSize: 11.5, marginTop: 3, color: tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--text-dim)' }}
            >
              {tone === 'up' && <ArrowUp size={11} />}
              {tone === 'down' && <ArrowDown size={11} />}
              <span>
                {delta > 0 ? '+' : ''}
                {fmtCount(delta)} from {previous.label}
              </span>
            </div>
          ) : (
            <div className="dt-kpi-sub">No prior month’s target to compare</div>
          )}
        </>
      ) : (
        <div className="dim" style={{ fontSize: 13, marginTop: 10 }}>Not set yet</div>
      )}

      {open && canSet && (
        <SetTargetForm
          defaultValue={current?.target_count}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onSaved?.()
          }}
        />
      )}
    </div>
  )
}

/** The PM's own inline form: which Shamsi month, how many villages, why. */
function SetTargetForm({ defaultValue, onClose, onSaved }) {
  const toast = useToast()
  const running = currentShamsiPeriod()
  const [period, setPeriod] = useState(running || { year: 0, month: 0 })
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
      toast.error('That is not a number of villages', 'Enter a whole number.')
      return
    }
    setBusy(true)
    try {
      await api.put('/acceptance/plan', {
        shamsi_year: period.year,
        shamsi_month: period.month,
        target_count: value,
        note: note.trim() || undefined,
      })
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
      aria-label="Set the acceptance target"
    >
      <div className="field" style={{ margin: 0, marginBottom: 10 }}>
        <label>Shamsi month</label>
        <PeriodPicker period={period} onChange={setPeriod} disabled={busy} />
      </div>
      <div className="field" style={{ margin: 0, marginBottom: 10 }}>
        <label htmlFor="acc-plan-target">Target (villages)</label>
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
