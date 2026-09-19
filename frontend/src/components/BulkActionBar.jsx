/**
 * The one bottom action bar for a bulk-assign screen (HC Pool, DT Assignment).
 *
 * Stuck to the bottom of the table card rather than living above it, so
 * assigning never means scrolling back up to find the button after picking
 * rows further down the list.
 */
export default function BulkActionBar({
  selectedCount,
  onClear,
  contractors,
  contractorId,
  onSelectContractor,
  onAssign,
  busy,
  primaryLabel,
  primaryIcon: PrimaryIcon,
}) {
  return (
    <div className="bulk-bar">
      <div className="bulk-bar-count">
        <span>{selectedCount} site{selectedCount === 1 ? '' : 's'} selected</span>
        {selectedCount > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="bulk-bar-chips row wrap" style={{ gap: 8 }}>
        {contractors.length === 0 ? (
          <span className="dim" style={{ fontSize: 12.5 }}>No subcontractors available</span>
        ) : (
          contractors.map((c) => {
            const active = String(contractorId) === String(c.id)
            return (
              <button
                key={c.id}
                type="button"
                className="btn btn-sm"
                onClick={() => onSelectContractor(active ? '' : String(c.id))}
                style={{
                  background: active ? 'var(--signal)' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-muted)',
                  border: active ? 'none' : '1px solid var(--border)',
                }}
              >
                {c.name}
              </button>
            )
          })
        )}
      </div>

      <button
        className="btn btn-primary"
        disabled={!contractorId || selectedCount === 0 || busy}
        onClick={onAssign}
      >
        {busy ? <div className="spinner" /> : (
          <>
            {PrimaryIcon && <PrimaryIcon size={15} />} {primaryLabel}
          </>
        )}
      </button>
    </div>
  )
}
