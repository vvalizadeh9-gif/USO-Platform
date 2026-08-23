import { Search } from 'lucide-react'
import { AUTHORITY_LABEL, AUTHORITY_PILL, GROUP_LABEL, queueReason, rowStatus } from './status'

/**
 * The left pane: everything this person has to get through, in order.
 *
 * Rows are grouped by the bucket the server put them in rather than by one the
 * browser works out, so the chip counts and the group headings can never
 * disagree about where a village belongs.
 */
const labelFor = (buckets, key) =>
  buckets.find((b) => b.key === key)?.label || GROUP_LABEL[key] || key

export default function QueuePane({
  collapsed, buckets, bucket, counts, onBucket,
  search, onSearch, rows, loading, selected, onSelect,
}) {
  // One chip is always active, so the list is one group headed by that chip's
  // name. Grouping by each row's own bucket is kept for the unfiltered case,
  // where the list really is mixed — but a heading must never contradict the
  // filter above it, which is what "Recently validated · Ready to file" did.
  const groups = bucket
    ? [{ key: bucket, label: labelFor(buckets, bucket), rows }]
    : []
  if (!bucket) {
    for (const row of rows) {
      const last = groups[groups.length - 1]
      if (last && last.key === row.bucket) last.rows.push(row)
      else groups.push({ key: row.bucket, label: GROUP_LABEL[row.bucket], rows: [row] })
    }
  }

  return (
    <aside className={`card queue ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="queue-search">
        <Search size={14} className="dim" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Village or site code"
          aria-label="Search the queue"
        />
      </div>

      <div className="queue-filters">
        {buckets.map((b) => (
          <button
            key={b.key}
            className="queue-filter"
            aria-pressed={bucket === b.key}
            onClick={() => onBucket(b.key)}
          >
            {b.label}
            {counts?.[b.key] != null && <span className="n">{counts[b.key]}</span>}
          </button>
        ))}
      </div>

      <div className="queue-list">
        {loading && <div className="dim" style={{ padding: '18px 4px', fontSize: 13 }}>Loading…</div>}

        {!loading && rows.length === 0 && (
          <div className="dim" style={{ padding: '18px 4px', fontSize: 13 }}>
            Nothing here.
          </div>
        )}

        {groups.map((group, i) => (
          <div key={`${group.key}-${i}`}>
            <div className="queue-group">{group.label || group.key}</div>
            {group.rows.map((row) => (
              <QueueItem
                key={row.village_id}
                row={row}
                active={row.village_id === selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

function QueueItem({ row, active, onSelect }) {
  const status = rowStatus(row)
  return (
    <button
      className="queue-item"
      aria-current={active}
      onClick={() => onSelect(row.village_id)}
    >
      <div className="line">
        <span className="name">{row.village_name || row.village_code || '—'}</span>
        <span className="spacer" />
        <span className={`pill pill-xs ${AUTHORITY_PILL[status]}`}>
          {AUTHORITY_LABEL[status]}
        </span>
      </div>
      <div className="why">
        {row.site_code || '—'} · {queueReason(row)}
      </div>
    </button>
  )
}
