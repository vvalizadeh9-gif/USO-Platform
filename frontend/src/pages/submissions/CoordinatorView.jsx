// The read-only coordinator's Submissions (UEP-21 §4.8): four plain tiles and
// "Your villages", inside their own regions. No actions.
import { useCallback, useEffect, useState } from 'react'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { villageStatus } from './format'
import { CardError, CardHead, Dot, PlainTiles, ShamsiDay, SkeletonRows } from './parts'

export default function CoordinatorView({ summary }) {
  const [state, setState] = useState({ rows: null, error: '' })
  const load = useCallback(() => {
    api.fetchVillages()
      .then((d) => setState({ rows: d.rows, error: '' }))
      .catch((err) => setState({ rows: null, error: detailMessage(err, 'The list did not load.') }))
  }, [])
  useEffect(load, [load])
  const m = summary?.mojri
  const tiles = [
    { label: 'Ready to submit', value: summary?.ready.villages, aside: 'villages' },
    { label: 'Waiting for Mojri', value: m?.waiting, aside: 'villages' },
    { label: 'In Mojri', value: m?.in_mojri, aside: 'villages' },
    { label: 'Follow up with ICT', value: summary?.follow_up.late, aside: 'late', late: true },
  ]
  const rows = state.rows || []
  return (
    <>
      <PlainTiles tiles={tiles} />
      <article className="sb-card sb-list sb-full" aria-labelledby="sb-yours-title">
        <CardHead icon="send" title="Your villages" id="sb-yours-title">
          <span className="sb-head-total">{state.rows ? formatNumber(rows.length) : ''}</span>
        </CardHead>
        <div className="sb-thead sb-coord-row" role="row">
          <span>Site ID</span><span>Village code</span><span>Village</span><span>Province</span>
          <span>CRA region</span><span>Status</span><span>MTN letter</span>
        </div>
        <div className="sb-scroll">
          {state.error && <CardError message={state.error} onRetry={load} />}
          {!state.rows && !state.error && <SkeletonRows />}
          {rows.map((r) => {
            const st = villageStatus(r)
            return (
              <div key={r.village_id} className="sb-row sb-coord-row" role="row">
                <span className="sb-strong">{r.site_code}</span>
                <span className="sb-num">{r.village_code}</span>
                <span className="sb-fa">{r.village_name}</span>
                <span className="sb-fa">{r.province || '—'}</span>
                <span>{r.cra_region || '—'}</span>
                <span className={`sb-status ${st.tone === 'danger' ? 'sb-late' : ''}`.trim()}><Dot tone={st.tone} />{st.label}</span>
                <span>{r.mtn_letter_date ? <ShamsiDay value={r.mtn_letter_date} /> : ''}</span>
              </div>
            )
          })}
        </div>
      </article>
    </>
  )
}
