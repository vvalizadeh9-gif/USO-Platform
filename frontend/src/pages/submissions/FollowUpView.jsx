// Follow up with ICT (UEP-21 §4.7): sent, still not in Mojri after 30 days.
// A village leaves this list only when a newer Mojri file shows it, or when
// it is sent again. There is no manual resolve.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { RaiseDialog } from './dialogs'
import { plural } from './format'
import { CardError, CardHead, ShamsiDay, SkeletonRows, Tag } from './parts'

export default function FollowUpView({ canAct, onChanged, followUpDays }) {
  const [state, setState] = useState({ data: null, error: '' })
  const [picked, setPicked] = useState(new Set())
  const [raising, setRaising] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const load = useCallback(() => {
    api.fetchFollowUp()
      .then((data) => { setState({ data, error: '' }); setPicked(new Set()) })
      .catch((err) => setState({ data: null, error: detailMessage(err, 'The list did not load.') }))
  }, [])
  useEffect(load, [load])

  const rows = state.data?.rows || []
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const done = () => { load(); onChanged() }

  async function resend() {
    setBusy(true)
    setActionError('')
    try {
      await api.sendAgain([...picked])
      done()
    } catch (err) {
      setActionError(detailMessage(err, 'Send again did not go through.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="sb-card sb-list sb-full" aria-labelledby="sb-follow-title">
      <CardHead icon="time" tone="danger" title={`Sent, not in Mojri after ${followUpDays ?? 30} days`} id="sb-follow-title">
        {state.data && (
          <span className="sb-muted">Raised {formatNumber(state.data.raised)} · Not raised {formatNumber(state.data.not_raised)}</span>
        )}
      </CardHead>
      <div className="sb-thead sb-follow-row" role="row">
        {canAct ? (
          <input type="checkbox" aria-label="Select all" checked={rows.length > 0 && picked.size === rows.length}
            onChange={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map((r) => r.item_id)))} />
        ) : <span />}
        <span>Batch</span><span>Site ID</span><span>Village</span><span>CRA region</span><span>Waiting</span><span>Follow-up</span>
      </div>
      <div className="sb-scroll">
        {state.error && <CardError message={state.error} onRetry={load} />}
        {!state.data && !state.error && <SkeletonRows />}
        {state.data && !rows.length && <div className="sb-empty"><Icon name="checkmark--outline" size={20} /><b>Nothing to follow up</b></div>}
        {rows.map((r) => (
          <div key={r.item_id} className="sb-row sb-follow-row" role="row">
            {canAct ? <input type="checkbox" aria-label={`Select ${r.village_code}`} checked={picked.has(r.item_id)} onChange={() => toggle(r.item_id)} /> : <span />}
            <span>{r.batch_number ? <Link to={`/submissions/batches/${r.batch_number}`}>#{r.batch_number}</Link> : 'Outside UEP'}</span>
            <span className="sb-strong">{r.site_code}</span>
            <span><span className="sb-num">{r.village_code}</span> <span className="sb-fa">{r.village_name}</span></span>
            <span>{r.cra_region || '—'}</span>
            <span className="sb-late">{plural(r.waiting_days, 'day')}</span>
            <span>
              {r.raised_at
                ? <Tag tone="neutral" icon="email">Raised <ShamsiDay value={r.raised_at} /></Tag>
                : <span className="sb-muted">Not raised</span>}
            </span>
          </div>
        ))}
      </div>
      {canAct && picked.size > 0 && (
        <div className="sb-bulk is-sliding">
          <span><b>{formatNumber(picked.size)}</b> selected</span>
          {actionError && <span className="sb-error">{actionError}</span>}
          <span className="sb-grow" />
          <button type="button" className="uw-btn" onClick={resend} disabled={busy}><Icon name="renew" size={16} />Send again</button>
          <button type="button" className="uw-btn uw-btn-primary" onClick={() => setRaising(true)} disabled={busy}>
            <Icon name="email" size={16} />Mark raised with ICT
          </button>
        </div>
      )}
      <RaiseDialog
        open={raising}
        count={picked.size}
        onClose={() => setRaising(false)}
        onConfirm={async (note) => { await api.markRaised([...picked], note); done() }}
      />
    </article>
  )
}
