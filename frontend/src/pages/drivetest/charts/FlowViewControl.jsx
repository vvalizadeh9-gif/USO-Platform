/**
 * Which years "Where this is going" shows: each year on its own, or all of
 * them together, as one segmented control in the card header.
 *
 * It replaces "Cumulative / Monthly change" and a year dropdown that only
 * appeared on the second tab. That pair asked a reader to learn that
 * "Monthly change" meant "one year, counted from zero", and the from-zero
 * count drew a year that tested more than it put on air as coverage over
 * 100%. Every choice here is the same ledger, zoomed: see `flowView`.
 *
 * "All" is labelled with the span it covers -- "1404–1405" -- rather than
 * "All" or "Both", so it stays true as the programme runs into more years.
 * With a single year of data there is nothing to choose, and no control.
 *
 * Still a tab list: what it switches is the one panel under it.
 */
export default function FlowViewControl({ years, scope, onScope }) {
  if (years.length < 2) return null
  const options = [
    ...years.map((y) => ({ key: y, label: String(y) })),
    { key: 'all', label: `${years[0]}–${years[years.length - 1]}` },
  ]
  return (
    <div className="dt-seg" role="tablist" aria-label="Years shown">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={scope === o.key}
          className={scope === o.key ? 'is-on' : undefined}
          onClick={() => onScope(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
