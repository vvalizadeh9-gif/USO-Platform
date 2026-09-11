import { motion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'

/**
 * Card chrome with its three states in one place: loading, failed, loaded.
 *
 * The dashboard this replaces had no failed state at all. A section whose
 * fetch rejected set its data to null and returned null from its component,
 * so the section vanished and the page came up shorter with nothing to say a
 * section existed, let alone that it had failed. Splitting the fetches so one
 * failure could not blank the whole page was the right instinct; disappearing
 * was not the only alternative to it.
 *
 * The skeleton matters for the same reason. A section that is merely absent
 * while it loads makes the page reflow under the reader as each one lands;
 * a block of the right size that fills in does not.
 */
export default function Section({
  title,
  subtitle,
  actions,
  state,
  onRetry,
  children,
  skeletonRows = 4,
  id,
  className = '',
}) {
  const { data, error, loading } = state

  return (
    <motion.section
      className={`dt-section ${className}`}
      id={id}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      aria-busy={loading || undefined}
    >
      <header className="dt-section-head">
        <div>
          <h2 className="dt-section-title">{title}</h2>
          {subtitle && <p className="dt-section-sub dt-farsi">{subtitle}</p>}
        </div>
        {actions && <div className="dt-section-actions">{actions}</div>}
      </header>

      <div className="dt-section-body">
        {error ? (
          <div className="dt-failed" role="alert">
            <AlertCircle size={17} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>Couldn&rsquo;t load {title.toLowerCase()}.</b> The rest of this page is
              unaffected.
            </span>
            {onRetry && (
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                <RefreshCw size={13} aria-hidden="true" /> Retry
              </button>
            )}
          </div>
        ) : loading && !data ? (
          <Skeleton rows={skeletonRows} />
        ) : data ? (
          typeof children === 'function' ? children(data) : children
        ) : (
          <div className="dt-empty">Nothing to show yet.</div>
        )}
      </div>
    </motion.section>
  )
}

function Skeleton({ rows }) {
  return (
    <div className="dt-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="dt-skeleton-row" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  )
}
