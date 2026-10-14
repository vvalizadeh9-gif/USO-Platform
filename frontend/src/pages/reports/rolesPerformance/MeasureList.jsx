// The measure list: the left card on Month and on Area. Groups of rows, one
// selected at a time (solid accent, aria-pressed); the selection lives in the
// URL (?measure=) so a link can be shared. Built once for both tabs.
//
// A row is { key, label, value, sub?, kind?, notRecorded? }:
//   kind 'headline'  the group's main measure: bold name, 20px figure
//        'minor'     a 34px row in secondary ink
//        'even'      a 60px row, figure over a muted sub line (Area)
//        'info'      not a choice: a grey line with no button (Total villages)
import { IconTile } from './parts'
import { formatNumber } from '../../../lib/numbers'

export default function MeasureList({ label, groups, value, onChange }) {
  return (
    <section className="rp-card rp-measures" aria-label={label}>
      <div className="rp-measures-scroll">
        {groups.map((group) => (
          <div key={group.key} className="rp-mgroup" role="group" aria-label={group.title}>
            <div className="rp-mgroup-head">
              <IconTile name={group.icon} />
              <span className="rp-mgroup-title">{group.title}</span>
              {group.unit && <span className="rp-mgroup-unit">{group.unit}</span>}
            </div>
            {group.rows.map((row) => (
              <MeasureRow
                key={row.key}
                row={row}
                selected={row.key === value}
                onSelect={onChange}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function MeasureRow({ row, selected, onSelect }) {
  const kind = row.kind ?? 'minor'
  const figure = row.notRecorded ? (
    <span className="rp-mrow-nrec">Not recorded</span>
  ) : (
    <span className="rp-mrow-figure">
      <span className="rp-mrow-value">{formatNumber(row.value)}</span>
      {row.sub && <span className="rp-mrow-sub">{row.sub}</span>}
    </span>
  )
  if (kind === 'info') {
    return (
      <div className="rp-mrow rp-mrow-info" data-measure={row.key}>
        <span className="rp-mrow-label">{row.label}</span>
        {figure}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`rp-mrow rp-mrow-${kind}`}
      aria-pressed={selected}
      data-measure={row.key}
      onClick={() => onSelect(row.key)}
    >
      <span className="rp-mrow-label">{row.label}</span>
      {figure}
    </button>
  )
}
