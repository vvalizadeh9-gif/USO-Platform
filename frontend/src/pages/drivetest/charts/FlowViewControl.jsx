/**
 * The two readings of "Where this is going", as a segmented control in the
 * card header, with the year picker beside it when a single year is shown.
 *
 * It lives in the header rather than in the card body because the page owns
 * which reading is on screen: the header's info note describes the reading
 * too -- where its scale starts, which count it restarts -- and a control and
 * a note that disagree about what is being shown are worse than neither.
 *
 * Still a tab list, as the underline tabs it replaces were: two views of one
 * panel is what tabs are, whatever they look like.
 */
export default function FlowViewControl({ tab, onTab, years, year, onYear }) {
  return (
    <div className="dt-flow-view">
      <div className="dt-seg" role="tablist" aria-label="How to read the flow">
        {[
          { key: 'cumulative', label: 'Cumulative' },
          { key: 'year', label: 'Monthly change' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'is-on' : undefined}
            onClick={() => onTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'year' && years.length > 0 && (
        <select
          className="dt-flow-yearselect"
          aria-label="Year"
          value={year}
          onChange={(e) => onYear(Number(e.target.value))}
        >
          {years.map((yr) => (
            <option key={yr} value={yr}>
              {yr}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
