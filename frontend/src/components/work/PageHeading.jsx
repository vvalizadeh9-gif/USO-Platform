import Icon from '../Icon'
import PageHeader, { HeaderCount } from '../PageHeader'

/**
 * The work pages' heading (UEP-06 §2) on the one PageHeader (UEP-13 §3.5):
 * the step's name as the H1 and "196 waiting · 3 late" beside it (the
 * /me/home count, §3.2). History and Export on the right, Export last. The
 * H1 takes focus after an action (`headingRef`), so it carries tabindex -1.
 * `pill` counts sites instead of waiting items (Explorer).
 */
export default function PageHeading({ title, count, late, meta, pill = false, headingRef, historyOpen, onHistory, onExport, exporting, filters }) {
  return (
    <PageHeader
      title={title}
      headingRef={headingRef}
      count={
        meta ? (
          <span className="uw-heading-meta">{meta}</span>
        ) : count == null ? null : pill ? (
          <span className="uw-count-pill uw-num">
            {count.toLocaleString('en-US')} {count === 1 ? 'site' : 'sites'}
          </span>
        ) : (
          <span className="uw-heading-meta">
            <HeaderCount waiting={count} late={late} />
          </span>
        )
      }
      filters={filters}
      actions={
        <>
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
        </>
      }
    />
  )
}
