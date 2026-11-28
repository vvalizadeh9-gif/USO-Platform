import { GROUPS, SEGMENTS, barSegments, fmt, totals } from './dataImportModel'

/** The whole file at a glance: one stacked bar (New cobalt, No change grey,
 * Conflicts amber, Errors red) and the counts, split Drive test (sites) /
 * ICT / CRA (villages). `mini` draws only the bar, for History rows. */
export default function SummaryBar({ counts, mini = false }) {
  const segments = barSegments(counts)
  const t = totals(counts)
  const bar = (
    <div className={`di-bar ${mini ? 'is-mini' : ''}`.trim()} role="img"
      aria-label={SEGMENTS.map((s) => `${s.label} ${fmt(t[s.key])}`).join(', ')}>
      {segments.map((s) => (
        <span key={s.key} className={`di-bar-seg is-${s.tone}`} style={{ flexGrow: s.share }}
          title={`${s.label}: ${fmt(s.value)}`} />
      ))}
      {segments.length === 0 && <span className="di-bar-seg is-empty" />}
    </div>
  )
  if (mini) return bar
  return (
    <section className="di-card di-summary" aria-label="Summary">
      <div className="di-summary-totals">
        {SEGMENTS.map((s) => (
          <div key={s.key} className={`di-total is-${s.tone}`}>
            <span className="di-total-dot" aria-hidden="true" />
            <span className="di-total-label">{s.label}</span>
            <span className="di-total-value tnum">{fmt(t[s.key])}</span>
          </div>
        ))}
      </div>
      {bar}
      <table className="di-split">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Group</span></th>
            {SEGMENTS.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => (
            <tr key={g.key}>
              <th scope="row">{g.label} <span className="di-dim">{g.unit}</span></th>
              {SEGMENTS.map((s) => (
                <td key={s.key} className="tnum">{fmt(counts?.[g.key]?.[s.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
