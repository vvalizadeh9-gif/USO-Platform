import Icon from '../../components/Icon'

/**
 * The bar that slides up while sites are selected (UEP-11a §B6): how many,
 * Export them, copy their IDs, or clear the selection.
 */
export default function BulkBar({ count, onExport, exporting, onCopy, onClear }) {
  if (count === 0) return null
  return (
    <div className="exl-bulk" role="region" aria-label="Selected sites">
      <span className="exl-bulk-count" role="status">
        <b className="uw-num">{count.toLocaleString('en-US')}</b> selected
      </span>
      <button type="button" className="exl-bulk-btn" onClick={onExport} disabled={exporting} aria-busy={exporting || undefined}>
        <Icon name="download" size={16} /> Export
      </button>
      <button type="button" className="exl-bulk-btn" onClick={onCopy}>
        <Icon name="copy" size={16} /> Copy IDs
      </button>
      <button type="button" className="exl-bulk-clear" aria-label="Clear selection" onClick={onClear}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
