import { Download, MapPin, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { freshness } from './format'

/**
 * Refresh, export, and the scope the page is currently showing.
 *
 * THE PROVINCE PICKER IS GONE, and the province scope is not. They are two
 * different things and only the first was worth removing.
 *
 * The picker was a filter offered before the reader had seen anything to
 * filter — thirty-one names in a select, at the top of a page whose whole
 * job is to tell you which province to look at. Nobody arrives knowing. The
 * way people actually narrow this dashboard is from the province table, by
 * the row they just read, and that button is still there.
 *
 * What replaces it is the chip below, which appears only when a province is
 * applied. That is not decoration either: without it, narrowing from a table
 * row would leave the reader in a scoped dashboard with no control anywhere
 * on the page to leave it — a filter you can enter and not exit. The chip is
 * the way out, and it says where you are on the way.
 *
 * The freshness clock stays. The page described itself as "live on-air and
 * drive-test status" while fetching once on mount, so a tab left open all
 * morning served breakfast's numbers under a claim of being current. Either
 * the claim goes or the clock does; the clock is more useful.
 */
export default function Toolbar({
  provinceName,
  onClearProvince,
  onRefresh,
  refreshing,
  generatedAt,
  onExport,
  exporting,
}) {
  const age = useTicking(generatedAt)

  return (
    <div className="dt-toolbar">
      <div className="dt-scope">
        {provinceName ? (
          <span className="dt-scope-chip">
            <MapPin size={13} strokeWidth={2} aria-hidden="true" />
            <span className="dt-farsi">{provinceName}</span>
            <button
              type="button"
              className="dt-clear"
              onClick={onClearProvince}
              aria-label={`Show every province again, not just ${provinceName}`}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <span className="dt-scope-all">All provinces</span>
        )}
      </div>

      <div className="dt-toolbar-right">
        {age && (
          <span className="dt-freshness" title={new Date(generatedAt).toLocaleString()}>
            Updated {age}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh the dashboard"
        >
          <RefreshCw
            size={13}
            aria-hidden="true"
            className={refreshing ? 'dt-spin' : undefined}
          />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onExport} disabled={exporting}>
          <Download size={13} aria-hidden="true" />
          {exporting ? 'Preparing…' : 'Export DT workbook'}
        </button>
      </div>
    </div>
  )
}

/** Re-render the age label once a minute so it stays true while sitting open. */
function useTicking(generatedAt) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!generatedAt) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [generatedAt])
  return freshness(generatedAt)
}
