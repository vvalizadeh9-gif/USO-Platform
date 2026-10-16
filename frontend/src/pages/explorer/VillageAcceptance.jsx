import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { Fa } from '../../components/work/parts'
import { formatNumber } from '../../lib/numbers'
import {
  PANEL_MAX,
  ROOMY_MAX,
  SIDE_META,
  openVillages,
  orderVillages,
  sideChip,
  sideLine,
} from './explorerModel'

const AUTHORITIES = [
  { key: 'ict', label: 'ICT' },
  { key: 'cra', label: 'CRA' },
]

/**
 * Acceptance by village (UEP-11 §B5.3). Up to six villages, ICT and CRA as two
 * panels side by side; above that, one table whose body scrolls under a fixed
 * header. Rows are in the same order in both panels, so a village is on the
 * same line in each. All / Open filters the rows in either layout.
 */
export default function VillageAcceptance({ villages, counts, started, highlight }) {
  const ordered = useMemo(() => orderVillages(villages), [villages])
  const open = useMemo(() => openVillages(ordered), [ordered])
  const [filter, setFilter] = useState('all')
  const shown = filter === 'open' ? open : ordered
  const rootRef = useRef(null)

  // ?village= : the row is tinted, scrolled to and focused once it is drawn.
  useEffect(() => {
    if (!highlight) return
    const row = rootRef.current?.querySelector(`[data-village="${CSS.escape(highlight)}"]`)
    if (!row) return
    row.scrollIntoView?.({ block: 'nearest' })
    row.focus({ preventScroll: true })
  }, [highlight, villages])

  const body = !started ? (
    <p className="ex-empty">Acceptance starts when the site is on air and drive-tested.</p>
  ) : villages.length === 0 ? (
    <p className="ex-empty">No hadaf villages on this site.</p>
  ) : villages.length <= PANEL_MAX ? (
    <Panels key={filter} villages={shown} counts={counts} highlight={highlight} roomy={villages.length <= ROOMY_MAX} />
  ) : (
    <VillageTable key={filter} villages={shown} counts={counts} highlight={highlight} />
  )

  const showFilter = started && villages.length > 0
  return (
    <section className={`ex-acceptance ${villages.length > PANEL_MAX ? 'is-table' : ''}`.trim()} aria-labelledby="ex-acceptance-title" ref={rootRef}>
      <div className="ex-section-head">
        <h3 id="ex-acceptance-title">Acceptance by village</h3>
        {showFilter && (
          <FilterTabs value={filter} onChange={setFilter} all={ordered.length} open={open.length} />
        )}
      </div>
      <div className="ex-acceptance-body" id="ex-village-rows" role={showFilter ? 'tabpanel' : undefined} aria-labelledby={showFilter ? `ex-filter-${filter}` : undefined}>
        {body}
      </div>
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
    const next = value === 'all' ? 'open' : 'all'
    const key = e.key === 'Home' ? 'all' : e.key === 'End' ? 'open' : next
    onChange(key)
    ref.current?.querySelector(`#ex-filter-${key}`)?.focus()
  }
  return (
    <div className="ui-seg ex-filter" role="tablist" aria-label="Villages" ref={ref} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          id={`ex-filter-${t.key}`}
          type="button"
          role="tab"
          className="ui-seg-option"
          aria-selected={value === t.key}
          aria-controls="ex-village-rows"
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
        >
          {t.label} <span className="ex-filter-n">{formatNumber(t.n)}</span>
        </button>
      ))}
    </div>
  )
}

/** The status word with its mark: a tinted circle and an icon, never colour
 * alone, and the dated line under it. */
export function StatusMark({ side, authority }) {
  const meta = SIDE_META[side.status]
  const line = sideLine(side, authority)
  const chip = sideChip(side)
  return (
    <span className={`ex-mark is-${side.status}`}>
      <span className="ex-mark-circle" aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
      <span className="ex-mark-text">
        <span className="ex-mark-word">
          <span className="uw-sr-only">{authority}: </span>
          {meta.label}
          {chip && <span className="ex-mark-chip">{chip}</span>}
        </span>
        {line && <span className="ex-mark-line">{line}</span>}
      </span>
    </span>
  )
}

/** "ICT" / "CRA" as its authority's soft chip, then the three large counts. */
function AuthorityHead({ label, count }) {
  return (
    <div className="ex-authority-head">
      <span className="ex-authority" data-authority={label.toLowerCase()}>{label}</span>
      <dl className="ex-counts">
        {['approved', 'pending', 'rejected'].map((status) => (
          <div key={status} className={`ex-count is-${status} ${count[status] === 0 ? 'is-zero' : ''}`.trim()}>
            <dt>{SIDE_META[status].label}</dt>
            <dd>{formatNumber(count[status])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function VillageCell({ village }) {
  return (
    <span className="ex-village">
      {/* The name may be cut short in a narrow panel; the title keeps it whole. */}
      <span className="ex-village-name" title={village.name || undefined}>{village.name ? <Fa>{village.name}</Fa> : <span className="ex-missing">—</span>}</span>
      <span className="ex-village-id">{village.code || '—'}</span>
    </span>
  )
}

function Panels({ villages, counts, highlight, roomy }) {
  return (
    <div className={`ex-panels ex-fade ${roomy ? 'is-roomy' : 'is-compact'}`}>
      {AUTHORITIES.map((a) => (
        <section key={a.key} className="ex-panel" aria-label={`${a.label} acceptance`}>
          <AuthorityHead label={a.label} count={counts[a.key]} />
          <ul className="ex-rows">
            {villages.map((v) => (
              <li
                key={v.id}
                className={`ex-row ${v.code && v.code === highlight ? 'is-highlight' : ''}`.trim()}
                // One focus target per village: the ICT panel's row.
                {...(a.key === 'ict' ? { 'data-village': v.code ?? '', tabIndex: -1 } : {})}
              >
                <VillageCell village={v} />
                <StatusMark side={v[a.key]} authority={a.label} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {villages.length === 0 && <p className="ex-empty ex-panels-empty">Every village is fully approved.</p>}
    </div>
  )
}

function VillageTable({ villages, counts, highlight }) {
  return (
    <div className="ex-table-scroll ex-fade" tabIndex={0} role="region" aria-label="Villages, ICT and CRA status (scrolls)">
      <table className="ex-table">
        <thead>
          <tr>
            <th scope="col" className="ex-table-village">Village</th>
            {AUTHORITIES.map((a) => (
              <th key={a.key} scope="col" aria-label={`${a.label} status`}>
                <AuthorityHead label={a.label} count={counts[a.key]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {villages.map((v) => (
            <tr
              key={v.id}
              className={v.code && v.code === highlight ? 'is-highlight' : undefined}
              data-village={v.code ?? ''}
              tabIndex={-1}
            >
              <th scope="row"><VillageCell village={v} /></th>
              {AUTHORITIES.map((a) => (
                <td key={a.key}><StatusMark side={v[a.key]} authority={a.label} /></td>
              ))}
            </tr>
          ))}
          {villages.length === 0 && (
            <tr>
              <td colSpan={3} className="ex-empty">Every village is fully approved.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
