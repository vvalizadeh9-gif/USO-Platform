/**
 * Which year "Where this is going" shows, as one segmented control in the
 * card header: one option per Shamsi year the payload covers, the latest
 * selected until a reader picks another.
 *
 * There used to be a third option spanning every year ("1404–1405"). It was
 * removed: the chart reads one year at a time. With a single year of data
 * there is nothing to choose, and no control.
 *
 * Still a tab list: what it switches is the one panel under it.
 */
export default function FlowViewControl({ years, scope, onScope }) {
  if (years.length < 2) return null
  const current = years.includes(scope) ? scope : years[years.length - 1]
  const options = years.map((y) => ({ key: y, label: String(y) }))
  return (
    <div className="ui-seg" role="tablist" aria-label="Years shown">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={current === o.key}
          className="ui-seg-option"
          onClick={() => onScope(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
