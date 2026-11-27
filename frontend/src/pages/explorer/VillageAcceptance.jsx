import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { Fa } from '../../components/work/parts'
import { formatNumber } from '../../lib/numbers'
import { SIDE_META, openVillages, orderVillages, sideChip, sideLine } from './explorerModel'

const AUTHORITIES = [
  { key: 'ict', label: 'ICT' },
  { key: 'cra', label: 'CRA' },
]
const STATUSES = ['approved', 'pending', 'rejected']

/**
 * Acceptance by village (UEP-28 §B5): one table for every site -- Village,
 * ICT, CRA -- under a sticky header carrying each authority's counts. Rows
 * worst first; dates only, no aging. The box ends where its rows end and only
 * its body scrolls. All / Open filters the rows.
 */
export default function VillageAcceptance({ villages, counts, started, highlight }) {
  const ordered = useMemo(() => orderVillages(villages), [villages])
  const open = useMemo(() => openVillages(ordered), [ordered])
  const [filter, setFilter] = useState('all')
  const rootRef = useRef(null)

  // A highlighted village is never hidden by Open, and is scrolled into view.
  useEffect(() => {
    if (!highlight) return
    if (filter === 'open' && !open.some((v) => v.code === highlight)) setFilter('all')
    const row = rootRef.current?.querySelector(`[data-village="${CSS.escape(highlight)}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, filter, open])

  const showFilter = started && villages.length > 0
  return (
    <section className="exa" aria-labelledby="exa-title" ref={rootRef}>
      <div className="exa-head">
        <h3 id="exa-title" className="ex-card-title">Acceptance by village</h3>
        {showFilter && <FilterTabs value={filter} onChange={setFilter} all={ordered.length} open={open.length} />}
      </div>
      {!started ? (
        <p className="exa-empty">Acceptance starts when drive test is done.</p>
      ) : villages.length === 0 ? (
        <p className="exa-empty">No target villages on this site.</p>
      ) : (
        <VillageTable
          key={filter}
          villages={filter === 'open' ? open : ordered}
          counts={counts}
          highlight={highlight}
          panelId={`exa-${filter}`}
        />
      )}
    </section>
  )
}

/** All {n} / Open {n}: a two-tab tab list over the rows. */
function FilterTabs({ value, onChange, all, open }) {
  const ref = useRef(null)
  const tabs = [
    { key: 'all', label: 'All', n: all },
    { key: 'open', label: 'Open', n: open },
  ]
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const key = e.key === 'Home' ? 'all' : e.key === 'End' ? 'open' : value === 'all' ? 'open' : 'all'
    onChange(key)
    ref.current?.querySelector(`#exa-tab-${key}`)?.focus()
  }
  return (
    <div className="ui-seg exa-tabs" role="tablist" aria-label="Villages" ref={ref} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={`exa-tab-${t.key}`}
          type="button"
          role="tab"
          className="ui-seg-option"
          aria-selected={value === t.key}
          aria-controls={`exa-${t.key}`}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
        >
          {t.label} <b className="uw-num">{formatNumber(t.n)}</b>
        </button>
      ))}
    </div>
  )
}

/** The status word with its mark (never colour alone) and its dated line. */
export function StatusMark({ side, authority }) {
  const meta = SIDE_META[side.status]
  const line = sideLine(side)
  const chip = sideChip(side)
  return (
    <span className={`exa-mark is-${side.status}`}>
      <span className="exa-mark-circle" aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
      <span className="exa-mark-text">
        <span className="exa-mark-word">
          <span className="uw-sr-only">{authority}: </span>
          {meta.label}
          {chip && <span className="exa-mark-tag">{chip}</span>}
        </span>
        {line && <span className="exa-mark-line">{line}</span>}
      </span>
    </span>
  )
}

/** "ICT  2 approved · 1 pending · 0 rejected". */
function AuthorityHead({ authority, count }) {
  return (
    <span className="exa-auth-head">
      <span className="auth-chip ex-auth" data-authority={authority.key}>{authority.label}</span>
      <span className="exa-counts">
        {STATUSES.map((status) => (
          <span key={status} className={`exa-count is-${status} ${count[status] ? '' : 'is-zero'}`.trim()}>
            <b className="uw-num">{formatNumber(count[status])}</b> {SIDE_META[status].label.toLowerCase()}
          </span>
        ))}
      </span>
    </span>
  )
}

function VillageTable({ villages, counts, highlight, panelId }) {
  return (
    <div className="exa-scroll" id={panelId} role="tabpanel" aria-labelledby={panelId.replace('exa-', 'exa-tab-')} tabIndex={0}>
      <table className="exa-table">
        <thead>
          <tr>
            <th scope="col" className="exa-col-village">Village</th>
            {AUTHORITIES.map((a) => (
              <th key={a.key} scope="col" className={`exa-col-${a.key}`} aria-label={`${a.label} status`}>
                <AuthorityHead authority={a} count={counts[a.key]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {villages.map((v, i) => (
            <tr
              key={v.id}
              className={v.code && v.code === highlight ? 'is-highlight' : undefined}
              data-village={v.code ?? ''}
              style={{ '--exa-i': i }}
            >
              <th scope="row">
                <span className="exa-village">
                  <span className="exa-village-name">{v.name ? <Fa>{v.name}</Fa> : '—'}</span>
                  <span className="exa-village-id uw-num">{v.code || '—'}</span>
                </span>
              </th>
              {AUTHORITIES.map((a) => (
                <td key={a.key}><StatusMark side={v[a.key]} authority={a.label} /></td>
              ))}
            </tr>
          ))}
          {villages.length === 0 && (
            <tr>
              <td colSpan={3} className="exa-all-done">Every village is approved for ICT and CRA.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
