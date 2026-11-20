// Filing's left column (UEP-22 §3.1): one authority's open cases, waiting
// with the contractors and rejected in the team baskets, oldest first.
import Icon from '../../components/Icon'
import { formatNumber } from '../../lib/numbers'
import { TABS } from './filingModel'

function Row({ row, selected, ticked, onSelect, onTick, canTick }) {
  return (
    <div className={`fl-row${selected ? ' is-selected' : ''}`}>
      {canTick && (
        <input
          type="checkbox"
          className="fl-tick"
          checked={ticked}
          aria-label={`Select ${row.village_name || row.village_code}`}
          onChange={() => onTick(row.village_id)}
        />
      )}
      <button
        type="button"
        className="fl-row-main"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(row.village_id)}
      >
        <span className={`fl-dot is-${row.state}`} aria-hidden="true" />
        <span className="fl-row-text">
          <span className="fl-row-name fa">{row.village_name || row.village_code}</span>
          <span className="fl-row-sub">
            {row.sub}
            {row.stale && <span className="fl-danger"> · no comment</span>}
            {row.in_validation && <span className="fl-tag-validation">In validation</span>}
          </span>
        </span>
        <span className={`fl-row-days${row.over_sla ? ' fl-danger' : ''}`}>{row.days_in_basket} d</span>
      </button>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="fl-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => <span key={i} className="fl-skel-row" />)}
    </div>
  )
}

export default function Inbox({
  authority, inbox, error, loading, tab, onTab, query, onQuery, selectedId, onSelect,
  ticked, onTick, canTick, onRetry, filterLabel, onClearFilter,
}) {
  const counts = inbox?.counts
  return (
    <section className="fl-inbox" aria-label={`${authority} inbox`}>
      <div className="fl-inbox-head">
        <h1 className="fl-inbox-title">
          {authority} inbox <span className="fl-inbox-count">{counts ? formatNumber(counts.all) : ''}</span>
        </h1>
        <label className="fl-search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search or paste codes</span>
          <input
            value={query}
            placeholder="Search or paste codes"
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        {filterLabel && (
          <p className="fl-filter">
            <span>{filterLabel}</span>
            <button type="button" className="fl-link" onClick={onClearFilter}>Clear</button>
          </p>
        )}
        <div className="fl-tabs" role="tablist" aria-label="Inbox tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className="fl-tab"
              onClick={() => onTab(t.key)}
            >
              {t.tone && t.tone !== 'danger' && <span className={`fl-dot is-${t.tone}`} aria-hidden="true" />}
              {t.label}
              <span className={`fl-tab-n${t.key === 'no_comment' ? ' fl-danger' : ''}`}>
                {counts ? formatNumber(counts[t.key]) : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="fl-inbox-list">
        {loading && !inbox && <Skeleton />}
        {error && (
          <div className="fl-error" role="alert">
            <span>{error}</span>
            <button type="button" className="uw-btn uw-btn-sm" onClick={onRetry}>Retry</button>
          </div>
        )}
        {inbox && inbox.shown === 0 && (
          <div className="fl-empty">
            <Icon name="checkmark--outline" size={20} />
            <span>Nothing waiting in your inbox</span>
          </div>
        )}
        {inbox?.groups.map((g) => g.rows.length > 0 && (
          <div key={g.key} className="fl-group">
            <div className={`fl-group-head is-${g.key}`}>
              <span>{g.label}</span><span>{formatNumber(g.count)}</span>
            </div>
            {g.rows.map((row) => (
              <Row
                key={row.case_id}
                row={row}
                selected={row.village_id === selectedId}
                ticked={ticked.has(row.village_id)}
                onSelect={onSelect}
                onTick={onTick}
                canTick={canTick}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="fl-keys" aria-hidden="true">
        <span><kbd>J</kbd> <kbd>K</kbd> move</span>
        <span><kbd>W</kbd> <kbd>A</kbd> <kbd>R</kbd> choose</span>
        <span><kbd>Ctrl</kbd> <kbd>Enter</kbd> save</span>
      </div>
    </section>
  )
}
