// Sent batches (UEP-21 §4.6): one card, every batch; a row opens its page.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { batchStatus } from './format'
import { CardError, CardHead, MojriBar, ShamsiDay, SkeletonRows, Tag } from './parts'

function Letters({ letters, recorded }) {
  return (
    <span className="sb-letters" aria-label={`${recorded} of 3 letters recorded`}>
      {['mtn', 'ict', 'cra'].map((k) => (
        <i key={k} className={letters[k].no || letters[k].date ? 'is-on' : ''} />
      ))}
      <span className="sb-muted">{recorded}/3</span>
    </span>
  )
}

export default function BatchesView() {
  const [state, setState] = useState({ rows: null, error: '' })
  const load = useCallback(() => {
    api.fetchBatches()
      .then((d) => setState({ rows: d.rows, error: '' }))
      .catch((err) => setState({ rows: null, error: detailMessage(err, 'The batches did not load.') }))
  }, [])
  useEffect(load, [load])
  const rows = state.rows || []
  return (
    <article className="sb-card sb-list sb-full" aria-labelledby="sb-batches-title">
      <CardHead icon="recently-viewed" tone="neutral" title="All batches" id="sb-batches-title">
        <span className="sb-head-total">{state.rows ? formatNumber(rows.length) : ''}</span>
      </CardHead>
      <div className="sb-thead sb-batch-row" role="row">
        <span>Batch</span><span>MTN letter date</span><span>Villages</span><span>Sites</span>
        <span>Letters</span><span>In Mojri</span><span>Status</span><span />
      </div>
      <div className="sb-scroll">
        {state.error && <CardError message={state.error} onRetry={load} />}
        {!state.rows && !state.error && <SkeletonRows />}
        {state.rows && !rows.length && <div className="sb-empty"><b>No batches yet</b></div>}
        {rows.map((b) => {
          const st = batchStatus(b.status)
          return (
            <Link key={b.number} to={`/submissions/batches/${b.number}`} className="sb-row sb-batch-row">
              <span className="sb-strong">#{b.number}</span>
              <span><ShamsiDay value={b.mtn_letter_date} /></span>
              <span className="sb-num">{formatNumber(b.villages)}</span>
              <span className="sb-num sb-muted">{formatNumber(b.sites)}</span>
              <Letters letters={b.letters} recorded={b.letters_recorded} />
              <MojriBar split={b.mojri} showPct />
              <span><Tag tone={st.tone}>{st.label}</Tag></span>
              <span className="sb-muted">{b.imported ? 'Imported' : ''}</span>
            </Link>
          )
        })}
      </div>
    </article>
  )
}
