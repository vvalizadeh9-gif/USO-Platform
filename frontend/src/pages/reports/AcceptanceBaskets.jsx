// Insights › Acceptance baskets (UEP-22 §3.2): every basket against time in
// basket -- who holds what, for how long, and who gives no updates. The grid
// and the selected cell each scroll inside their card; the page does not.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageFrame from '../../components/PageFrame'
import { SegmentedControl } from '../../components/ui'
import { formatNumber } from '../../lib/numbers'
import { usePageCrumb } from '../../shell/crumbs'
import { fetchBasketCell, fetchBaskets } from '../filing/api'
import { AGE_COLUMNS, cellClass, columnMax, filingLink, grouped, initials, villageLink } from './basketsModel'
import '../../styles/work.css'
import '../../styles/filing.css'
import '../../styles/acceptance-baskets.css'

const AUTHORITY_OPTIONS = [{ key: 'ict', label: 'ICT' }, { key: 'cra', label: 'CRA' }, { key: 'both', label: 'Both' }]
const errorText = (err) => err?.response?.data?.detail?.message || 'Could not load'

function Cell({ row, column, value, max, selected, onPick }) {
  const label = `${row.label}, ${column.label}, ${value} villages`
  const cls = column.key === 'no_comment' ? (value ? 'is-stripes' : 'is-zero') : cellClass(column.key, value, max)
  return (
    <button
      type="button"
      className={`bk-cell ${cls}${selected ? ' is-selected' : ''}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onPick(row.key, column.key)}
    >
      {value ? formatNumber(value) : '·'}
    </button>
  )
}

function Grid({ grid, selected, onPick }) {
  const cols = grid.columns
  const max = columnMax(grid.rows)
  const ages = cols.filter((c) => AGE_COLUMNS.includes(c.key))
  const noComment = cols.find((c) => c.key === 'no_comment')
  const total = cols.find((c) => c.key === 'total')
  return (
    <section className="bk-card bk-grid-card" aria-label="Baskets by time in basket">
      <div className="bk-grid bk-grid-head">
        <span className="bk-caption">Time in basket</span>
        {ages.map((c) => (
          <span key={c.key} className={`bk-col${c.key === 'u3' ? '' : ' is-late'}`}>
            <span className="bk-col-n">{formatNumber(c.total)}</span>
            <span className="bk-col-label">{c.label}</span>
          </span>
        ))}
        <span />
        <span className="bk-col is-late">
          <span className="bk-col-n">{formatNumber(noComment.total)}</span>
          <span className="bk-col-label">No comment</span>
        </span>
        <span className="bk-caption bk-right">Total</span>
      </div>
      <div className="bk-grid-body">
        {grouped(grid.rows).map((g) => (
          <div key={g.label} role="rowgroup" aria-label={g.label}>
            <div className="bk-group">{g.label}</div>
            {g.rows.map((row) => (
              <div key={row.key} className="bk-grid bk-row">
                <span className="bk-name">
                  <span className={`bk-mark is-${row.kind}`} aria-hidden="true">{initials(row.label)}</span>
                  <span className="bk-name-text">{row.label}</span>
                </span>
                {ages.map((c) => (
                  <Cell key={c.key} row={row} column={c} value={row.cells[c.key]} max={max[c.key]}
                    selected={selected?.basket === row.key && selected?.column === c.key} onPick={onPick} />
                ))}
                <span />
                <Cell row={row} column={noComment} value={row.cells.no_comment}
                  selected={selected?.basket === row.key && selected?.column === 'no_comment'} onPick={onPick} />
                <button type="button" className="bk-total" onClick={() => onPick(row.key, total.key)}
                  aria-label={`${row.label}, total, ${row.cells.total} villages`}>
                  {formatNumber(row.cells.total)}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="bk-legend">
        <span><i className="bk-swatch is-blue" />Under 3 months</span>
        <span><i className="bk-swatch is-red" />Over 3 months</span>
        <span><i className="bk-swatch is-stripes" />No comment in {grid.fresh_days} d</span>
      </div>
    </section>
  )
}

function Detail({ cell, error, onRetry, authority }) {
  return (
    <section className="bk-card bk-detail" aria-label="Villages in basket">
      {error && (
        <div className="fl-error" role="alert"><span>{error}</span>
          <button type="button" className="uw-btn uw-btn-sm" onClick={onRetry}>Retry</button></div>
      )}
      {!cell && !error && <div className="fl-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="fl-skel-row" />)}</div>}
      {cell && (
        <>
          <div className="bk-detail-head">
            <span className="bk-mark is-team" aria-hidden="true">{initials(cell.label)}</span>
            <span className="bk-detail-title">
              <span className="bk-detail-name">{cell.label} · {cell.column_label}</span>
              <span className="bk-detail-sub">
                {formatNumber(cell.count)} villages · {formatNumber(cell.no_comment)} with no fresh comment
              </span>
            </span>
            <Link to={filingLink({ basket: cell.basket, column: cell.column, authority })}>Open in Filing</Link>
          </div>
          <div className="bk-detail-list">
            {cell.items.length === 0 && <p className="fl-empty">Nothing in this cell</p>}
            {cell.items.map((item) => (
              <Link key={item.case_id} to={villageLink(item)} className="bk-item">
                <span className="bk-item-top">
                  <span className={`fl-auth is-${item.authority.toLowerCase()}`}>{item.authority}</span>
                  <span className="bk-item-name fa">{item.village_name || item.village_code}</span>
                  <span className="bk-item-id">{item.village_code || item.village_id}</span>
                  <span className="bk-item-days fl-danger">{item.days_in_basket} d</span>
                </span>
                <span className={`bk-item-comment${item.stale ? ' fl-danger is-strong' : ''}`}>
                  {item.stale
                    ? (item.comment_age == null ? 'No comment yet' : `Last comment ${item.comment_age} d ago · needs an update`)
                    : `“${item.comment?.text || ''}” · ${item.comment_age} d ago`}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default function AcceptanceBaskets() {
  usePageCrumb('Acceptance baskets')
  const [params, setParams] = useSearchParams()
  const authority = AUTHORITY_OPTIONS.some((o) => o.key === params.get('authority')) ? params.get('authority') : 'both'
  const [grid, setGrid] = useState(null)
  const [gridError, setGridError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [cell, setCell] = useState(null)
  const [cellError, setCellError] = useState(null)

  const loadGrid = useCallback(() => {
    setGridError(null)
    fetchBaskets(authority)
      .then((g) => { setGrid(g); setSelected((s) => s || g.default) })
      .catch((err) => setGridError(errorText(err)))
  }, [authority])
  useEffect(() => { loadGrid() }, [loadGrid])

  const loadCell = useCallback(() => {
    if (!selected) return
    setCell(null)
    setCellError(null)
    fetchBasketCell({ basket: selected.basket, bucket: selected.column, authority })
      .then(setCell)
      .catch((err) => setCellError(errorText(err)))
  }, [selected, authority])
  useEffect(() => { loadCell() }, [loadCell])

  return (
    <PageFrame className="bk-page" bar={null}>
      <div className="bk-head">
        <h1>Acceptance baskets</h1>
        {grid && (
          <span className="bk-head-sub">
            {formatNumber(grid.open)} open · <span className="fl-danger is-strong">{formatNumber(grid.no_comment)} with no fresh comment</span>
          </span>
        )}
        <span className="bk-grow" />
        <SegmentedControl
          label="Authority" className="fl-seg" options={AUTHORITY_OPTIONS} value={authority}
          onChange={(key) => { setSelected(null); setParams({ authority: key }, { replace: true }) }}
        />
      </div>
      <div className="bk-body">
        {gridError && (
          <section className="bk-card"><div className="fl-error" role="alert"><span>{gridError}</span>
            <button type="button" className="uw-btn uw-btn-sm" onClick={loadGrid}>Retry</button></div></section>
        )}
        {!grid && !gridError && <section className="bk-card"><div className="fl-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="fl-skel-row" />)}</div></section>}
        {grid && <Grid grid={grid} selected={selected} onPick={(basket, column) => setSelected({ basket, column })} />}
        <Detail cell={selected ? cell : null} error={cellError} onRetry={loadCell} authority={authority} />
      </div>
    </PageFrame>
  )
}
