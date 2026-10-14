import Icon from '../Icon'

/**
 * The page heading (UEP-06 §2): the current step's name as the H1, and on
 * its baseline "196 sites · 3 late". History and Export on the right. The H1
 * takes focus after an action (`headingRef`), so it carries tabindex -1.
 * `pill` shows the count as a neutral pill beside the title instead (Explorer).
 */
export default function PageHeading({ title, count, late, pill = false, headingRef, historyOpen, onHistory, onExport, exporting }) {
  return (
    <div className="uw-heading">
      <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
      {pill && count != null && (
        <span className="uw-count-pill uw-num">
          {count.toLocaleString('en-US')} {count === 1 ? 'site' : 'sites'}
        </span>
      )}
      {!pill && count != null && (
        <p className="uw-heading-meta">
          <b>{count.toLocaleString('en-US')} {count === 1 ? 'site' : 'sites'}</b>
          {late > 0 && (
            <>
              {' · '}
              <b className="uw-late">{late.toLocaleString('en-US')} late</b>
            </>
          )}
        </p>
      )}
      <span className="uw-heading-spacer" />
      {onHistory && (
        <button
          type="button"
          className={`uw-btn ${historyOpen ? 'is-current' : ''}`.trim()}
          aria-current={historyOpen ? 'page' : undefined}
          onClick={onHistory}
        >
          <Icon name="recently-viewed" size={16} /> History
        </button>
      )}
      {onExport && (
        <button type="button" className="uw-btn" onClick={onExport} disabled={exporting} aria-busy={exporting || undefined}>
          <Icon name="download" size={16} /> Export
        </button>
      )}
    </div>
  )
}
