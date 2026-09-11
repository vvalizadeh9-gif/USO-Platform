import { Download, MapPin, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { freshness } from './format'

/**
 * Filter, refresh and export — the three things the old page could not do.
 *
 * The freshness clock is not decoration. The page described itself as "live
 * on-air and drive-test status" while fetching once on mount, so a tab left
 * open all morning served breakfast's numbers under a claim of being current.
 * Either the claim goes or the clock does; the clock is more useful.
 */
export default function Toolbar({
  provinces,
  provinceId,
  onProvince,
  onRefresh,
  refreshing,
  generatedAt,
  onExport,
  exporting,
}) {
  const age = useTicking(generatedAt)
  const selected = provinces?.find((p) => p.id === provinceId)

  return (
    <div className="dt-toolbar">
      <div className="dt-filter">
        <MapPin size={14} strokeWidth={2} aria-hidden="true" />
        <label htmlFor="dt-province" className="dt-sr-only">
          Narrow to one province
        </label>
        <select
          id="dt-province"
          className="dt-select"
          value={provinceId ?? ''}
          onChange={(e) => onProvince(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">All provinces</option>
          {(provinces || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selected && (
          <button
            type="button"
            className="dt-clear"
            onClick={() => onProvince(null)}
            aria-label="Clear the province filter"
          >
            <X size={13} aria-hidden="true" />
          </button>
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
          {exporting ? 'Preparing…' : 'Export'}
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
