import { AlertCircle, RefreshCw } from '../../../components/carbon'

/**
 * A source that failed, in the KPI strip's place: the Drive test dashboard's
 * error banner (the cards get theirs from Section), the server's reason, and
 * a Retry that refetches that source only. The rest of the page stays.
 */
export default function CardFailed({ what, error, onRetry }) {
  return (
    <div className="banner banner-error dt-failed" role="alert">
      <AlertCircle className="banner-icon" size={18} strokeWidth={2} aria-hidden="true" />
      <span>
        <b>Couldn&rsquo;t load {what}.</b> {error}
      </span>
      <button type="button" className="btn" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" /> Retry
      </button>
    </div>
  )
}
