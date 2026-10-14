import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { shown } from './roundText'
import { formatNumber } from '../../lib/numbers'

const COLUMNS = ['Site', 'Province', 'Village ID', 'Village', 'Requested', 'DT date']

function factsOf(source) {
  return {
    workItemId: source.work_item_id,
    site: source.site_code,
    province: source.province_name,
    code: source.village_code,
    name: source.village_name,
    techs: source.requested_technologies || [],
    tech: (source.requested_technologies || []).join(' · '),
    dt: shown(source.dt_date_shamsi),
  }
}

/** The village record: its name, the same-site suggestion, five highlights. */
export function RequestedOne({ facts, suggestion, onTakeSuggestion }) {
  const f = factsOf(facts)
  const n = suggestion?.villages.length || 0
  return (
    <section className="ui-card mw-record" aria-label="Village">
      <div className="mw-record-top">
        <div className="mw-grow">
          <div className="mw-record-label">Village</div>
          <h2 className="mw-record-name" dir="auto">{f.name}</h2>
        </div>
        {n > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            title={suggestion.villages.map((v) => v.village_name).join('، ')}
            onClick={onTakeSuggestion}
          >
            Add {n} {n === 1 ? 'village' : 'villages'} from {suggestion.site_code}
          </button>
        )}
      </div>
      <dl className="mw-facts">
        <div><dt>Site</dt><dd>{f.workItemId ? <Link className="mw-link" to={`/work-items/${f.workItemId}`}>{f.site}</Link> : f.site}</dd></div>
        <div><dt>Province</dt><dd className="text-farsi">{f.province}</dd></div>
        <div><dt>Village ID</dt><dd>{f.code}</dd></div>
        <div><dt>Requested</dt><dd>{f.techs.map((t) => <span key={t} className="mw-tech-chip">{t}</span>)}</dd></div>
        <div><dt>DT date</dt><dd className="mw-fa-ltr">{f.dt}</dd></div>
      </dl>
    </section>
  )
}

/** Two or more villages ticked: the same six facts as a compact table. */
export function RequestedMany({ rows, onUntick, onClear }) {
  return (
    <section className="ui-card mw-requested mw-requested-many" aria-label="Requested">
      <div className="mw-requested-head">
        <h2 className="mw-record-many-title">One letter for {formatNumber(rows.length)} villages</h2>
        <button type="button" className="btn btn-sm" onClick={onClear}>Clear</button>
      </div>
      <div className="mw-req-table" role="table" aria-label="Ticked villages">
        <div className="mw-req-row mw-req-header" role="row">
          {COLUMNS.map((c) => <span key={c} role="columnheader">{c}</span>)}
          <span role="columnheader" aria-label="Remove" />
        </div>
        <div className="mw-req-body">
          {rows.map((row) => {
            const f = factsOf(row)
            return (
              <div key={row.village_id} className="mw-req-row" role="row">
                <span role="cell">{f.site}</span>
                <span role="cell" className="text-farsi-inline">{f.province}</span>
                <span role="cell">{f.code}</span>
                <span role="cell" className="text-farsi-inline mw-strong">{f.name}</span>
                <span role="cell">{f.tech}</span>
                <span role="cell" className="mw-fa-ltr">{f.dt}</span>
                <button type="button" className="mw-icon-btn" aria-label={`Take ${f.name} off`} onClick={() => onUntick(row.village_id)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
