import { useEffect, useRef, useState } from 'react'
import { formatNumber } from '../../lib/numbers'

/** Every selected filing has a reason: its own, or the shared one. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests
export function missingReasons(filings, shared, own) {
  if (shared.trim()) return []
  return filings.filter((f) => !(own[f.submission_id] || '').trim())
}

/**
 * Return, inline under the table (UEP-16 §3): one reason for all, and an
 * optional reason of its own per village. Blocked until every selected filing
 * has one; the reasons reach the contractor with the filing.
 */
export default function ReturnPanel({ filings, contractor, onSubmit, onCancel }) {
  const [shared, setShared] = useState('')
  const [own, setOwn] = useState({})
  const [tried, setTried] = useState(false)
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])

  const missing = missingReasons(filings, shared, own)
  const blocked = missing.length > 0
  const n = filings.length

  function submit(event) {
    event.preventDefault()
    setTried(true)
    if (blocked) return
    onSubmit({
      shared: shared.trim(),
      own: Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
    })
  }

  return (
    <form className="vl-return" onSubmit={submit} aria-label="Return filings">
      <label className="vl-field">
        <span>Reason for all {formatNumber(n)} selected</span>
        <textarea
          ref={first}
          rows={2}
          value={shared}
          maxLength={2000}
          onChange={(e) => setShared(e.target.value)}
          aria-invalid={tried && blocked && !shared.trim() ? 'true' : undefined}
          placeholder="What the contractor must fix"
        />
      </label>
      <div className="vl-own">
        {filings.map((f) => {
          const lacking = tried && missing.includes(f)
          return (
            <label key={f.submission_id} className="vl-own-row">
              <span className="vl-own-village">
                <b dir="ltr">{f.village_code}</b> <span className={`vl-badge is-${f.authority.toLowerCase()}`}>{f.authority}</span>
              </span>
              <input
                type="text"
                className="vl-input"
                value={own[f.submission_id] || ''}
                maxLength={2000}
                placeholder={lacking ? 'Reason missing' : 'Own reason (optional)'}
                aria-label={`Own reason for ${f.village_code}`}
                aria-invalid={lacking ? 'true' : undefined}
                onChange={(e) => setOwn((old) => ({ ...old, [f.submission_id]: e.target.value }))}
              />
            </label>
          )
        })}
      </div>
      {tried && blocked && (
        <p className="vl-error" role="alert">
          {formatNumber(missing.length)} {missing.length === 1 ? 'filing has' : 'filings have'} no reason. Add one for all, or one each.
        </p>
      )}
      <div className="vl-return-actions">
        <button type="submit" className="vl-btn is-danger-primary" aria-disabled={blocked || undefined}>
          Return {formatNumber(n)} to <bdi dir="rtl" lang="fa" className="vl-fa">{contractor || 'contractor'}</bdi>
        </button>
        <button type="button" className="vl-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
