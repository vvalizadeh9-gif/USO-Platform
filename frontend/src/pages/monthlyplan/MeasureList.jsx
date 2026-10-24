import Icon from '../../components/Icon'

// The left list card, the same pattern as Roles Performance: groups of 48px
// rows, one selected at a time (solid accent, aria-pressed).
//
// A group is { key, title, icon, count?, columns?, rows }. A row is
// { key, name, fa?, chips?, figures?, tag?, onSelect? }:
//   fa       the name is Persian text (a Shamsi month): set in Vazirmatn
//   chips    [{ key, label, tone }] -- small words such as DT / Acc
//   figures  [{ key, label, value, tone }] -- percentages, one per column
//   tag      a small word after the name (Planning, Running)
//   onSelect when set, the row opens something instead of becoming selected
// `value` is the selected row's key.
export default function MeasureList({ label, groups, value, onChange, columns }) {
  return (
    <section className="mp2-card mp2-list" aria-label={label}>
      <div className="mp2-list-scroll">
        {groups.map((group) => (
          <div key={group.key} className="mp2-group" role="group" aria-label={group.title}>
            <div className="mp2-group-head">
              <span className="mp2-tile" aria-hidden="true">
                <Icon name={group.icon} size={16} />
              </span>
              <span className="mp2-group-title">{group.title}</span>
              {group.count != null && <span className="mp2-group-count tnum">{group.count}</span>}
              {columns && group.key === columns.group && (
                <span className="mp2-columns" aria-hidden="true">
                  {columns.labels.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </span>
              )}
            </div>
            {group.rows.map((row) => (
              <button
                key={row.key}
                type="button"
                className="mp2-row"
                aria-pressed={row.onSelect ? undefined : row.key === value}
                data-row={row.key}
                onClick={() => (row.onSelect ? row.onSelect() : onChange(row.key))}
              >
                <span className={row.fa ? 'mp2-row-name mp-fa' : 'mp2-row-name'}>{row.name}</span>
                {row.tag && <span className="mp2-row-tag">{row.tag}</span>}
                {row.chips && (
                  <span className="mp2-row-chips">
                    {row.chips.map((chip) => (
                      <span key={chip.key} className="mp2-mini" data-tone={chip.tone}>
                        {chip.label}
                      </span>
                    ))}
                  </span>
                )}
                {row.figures && (
                  <span className="mp2-row-figures">
                    {row.figures.map((f) => (
                      <span key={f.key} className="mp2-figure tnum" data-tone={f.tone}>
                        {f.value}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/** Six skeleton rows while the list loads. */
export function ListSkeleton() {
  return (
    <section className="mp2-card mp2-list" aria-hidden="true">
      <div className="mp2-list-scroll">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mp2-row mp2-skel" />
        ))}
      </div>
    </section>
  )
}
