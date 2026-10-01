import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { shown } from './roundText'

const COLUMNS = ['Site ID', 'Province', 'Village ID', 'Village name', 'Requested tech', 'DT date']

function factsOf(source) {
  return {
    workItemId: source.work_item_id,
    site: source.site_code,
    province: source.province_name,
    code: source.village_code,
    name: source.village_name,
    tech: (source.requested_technologies || []).join(' · '),
    dt: shown(source.dt_date_shamsi),
  }
}

/** What CPM requested for the village being worked on, and nothing more. */
export function RequestedOne({ facts, suggestion, onTakeSuggestion, onPrev, onNext }) {
  const f = factsOf(facts)
  return (
    <section className="ui-card mw-requested" aria-label="Requested">
      <div className="mw-requested-head">
        <h2 className="mw-card-title">Requested</h2>
        {suggestion?.villages.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            title={suggestion.villages.map((v) => v.village_name).join('، ')}
            onClick={onTakeSuggestion}
          >
            + {suggestion.villages.length} from {suggestion.site_code}
          </button>
        )}
        <button type="button" className="btn btn-sm mw-square" aria-label="Previous village" onClick={onPrev}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-sm mw-square" aria-label="Next village" onClick={onNext}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <dl className="mw-facts">
        <div><dt>{COLUMNS[0]}</dt><dd>{f.workItemId ? <Link className="mw-link" to={`/work-items/${f.workItemId}`}>{f.site}</Link> : f.site}</dd></div>
        <div><dt>{COLUMNS[1]}</dt><dd className="text-farsi">{f.province}</dd></div>
        <div><dt>{COLUMNS[2]}</dt><dd>{f.code}</dd></div>
        <div><dt>{COLUMNS[3]}</dt><dd className="text-farsi mw-strong">{f.name}</dd></div>
        <div><dt>{COLUMNS[4]}</dt><dd>{f.tech}</dd></div>
        <div><dt>{COLUMNS[5]}</dt><dd className="mw-fa-ltr">{f.dt}</dd></div>
      </dl>
    </section>
  )
}

/** Two or more villages ticked: the same six facts as a compact table. */
export function RequestedMany({ rows, onUntick, onClear }) {
  return (
    <section className="ui-card mw-requested mw-requested-many" aria-label="Requested">
      <div className="mw-requested-head">
        <h2 className="mw-card-title">Requested <span className="count-chip tnum">{rows.length}</span></h2>
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
