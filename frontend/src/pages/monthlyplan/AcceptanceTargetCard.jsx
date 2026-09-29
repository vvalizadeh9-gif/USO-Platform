import { ArrowDown, ArrowUp, Flag, X } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { canSetAcceptancePlan } from '../../lib/roles'
import { fmtCount } from '../reports/kpiTheme'
import { planDeltaTone } from './figures'
import SetTargetForm from './SetTargetForm'

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
 * as the Internal PIP line on its progress chart (/acceptance/progress).
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
            style={{ marginInlineStart: 'auto', flexShrink: 0, padding: '2px 7px', fontSize: 'var(--fs-caption)' }}
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
          <div className="dt-kpi-sub">{current.label || 'Villages this month'}</div>
          {delta != null ? (
            <div
              className="row"
              style={{ gap: 4, fontSize: 'var(--fs-caption)', marginTop: 3, color: tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--text-tertiary)' }}
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
