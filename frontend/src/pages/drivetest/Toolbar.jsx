import { BookmarkPlus, Calendar, Download, Filter, MapPin, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { freshness } from './format'

export default function Toolbar({
  provinceId,
  provinceName,
  onClearProvince,
  onRefresh,
  refreshing,
  generatedAt,
  onExport,
  exporting,
}) {
  const age = useTicking(generatedAt)
  const scoped = provinceId != null

  return (
    <div className="dt-toolbar">
      <div className="dt-scope">
        {scoped ? (
          <span className="dt-scope-chip">
            <MapPin size={13} strokeWidth={2} aria-hidden="true" />
            {provinceName ? (
              <span className="dt-farsi">{provinceName}</span>
            ) : (
              <span>Province {provinceId}</span>
            )}
            <button
              type="button"
              className="dt-clear"
              onClick={onClearProvince}
              aria-label={
                provinceName
                  ? `Show every province again, not just ${provinceName}`
                  : 'Show every province again'
              }
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

        <button type="button" className="btn btn-sm dt-toolbar-filter" title="Saved views">
          <BookmarkPlus size={13} aria-hidden="true" />
          <span className="dt-toolbar-label">Saved Views</span>
        </button>

        <button type="button" className="btn btn-sm dt-toolbar-filter" title="Vendor filter">
          <Filter size={13} aria-hidden="true" />
          <span className="dt-toolbar-label">Vendor</span>
        </button>

        <button type="button" className="btn btn-sm dt-toolbar-filter" title="Date range">
          <Calendar size={13} aria-hidden="true" />
          <span className="dt-toolbar-label">Date range</span>
        </button>

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

function useTicking(generatedAt) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!generatedAt) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [generatedAt])
  return freshness(generatedAt)
}
