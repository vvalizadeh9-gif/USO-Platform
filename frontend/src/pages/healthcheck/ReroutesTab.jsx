import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import { ConfirmDialog, EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

/**
 * Fixes whose owning team says the category is wrong.
 *
 * A team given work that is not theirs may propose moving it, but not move it
 * themselves — deliberate friction, because letting owners reassign their own
 * work turns the queue into a hot potato and destroys the SLA record. Until a
 * decision lands the fix and its clock stay with the current owner, so a
 * disputed site can never fall between two teams.
 *
 * The decision endpoint has always existed and the Action Center has always
 * linked here. This is the screen that link was written for.
 */
export default function ReroutesTab({ onCountChange }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [pending, setPending] = useState(null) // {row, approve} | null
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState({ id: null, code: null })

  function load() {
    api
      .get('/hc/queues/reroutes')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setRows([]))
  }
  useEffect(load, [])

  async function decide() {
    if (!pending) return
    setBusy(true)
    try {
      await api.post(`/hc/fixes/${pending.row.id}/reroute/decide`, {
        approve: pending.approve,
      })
      toast.success(
        pending.approve ? 'Moved' : 'Kept where it was',
        pending.approve
          ? `${pending.row.site_code} is now ${pending.row.to_category}. The new team's clock starts today.`
          : `${pending.row.site_code} stays with ${pending.row.from_category}.`,
      )
      setPending(null)
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <Loading label="Loading re-route requests" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="Nothing disputed"
          hint="Requests appear here when a team says a fix belongs to someone else."
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <div key={r.id} className="card card-pad">
          <div className="row between wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row wrap" style={{ gap: 10, alignItems: 'baseline' }}>
                <SiteCodeButton
                  workItemId={r.work_item_id}
                  siteCode={r.site_code}
                  onOpen={(id, code) => setHistory({ id, code })}
                />
                <span className="dim" style={{ fontSize: 13 }}>{r.province}</span>
                <span className="dim" style={{ fontSize: 12.5 }}>
                  open {r.days_open} day{r.days_open === 1 ? '' : 's'}
                </span>
              </div>

              <div className="row wrap" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
                <span className="pill pill-dim">{r.from_category}</span>
                <ArrowRight size={15} style={{ color: 'var(--text-dim)' }} />
                <span className="pill pill-amber">{r.to_category}</span>
              </div>

              <p className="muted" style={{ fontSize: 13.5, marginTop: 10, maxWidth: '70ch' }}>
                {r.reason || 'No reason was given.'}
              </p>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                Proposed by {r.proposed_by || 'the owning team'}
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setPending({ row: r, approve: true })}
              >
                Move it
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setPending({ row: r, approve: false })}
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.approve ? 'Move this fix?' : 'Keep this fix where it is?'}
        message={
          pending?.approve
            ? `${pending.row.site_code} moves from ${pending.row.from_category} to ${pending.row.to_category}. The deadline restarts, because the new team has not had the site until now.`
            : `${pending?.row.site_code} stays with ${pending?.row.from_category}, and its deadline keeps running.`
        }
        confirmLabel={pending?.approve ? 'Yes, move it' : 'Yes, keep it'}
        busy={busy}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </div>
  )
}
