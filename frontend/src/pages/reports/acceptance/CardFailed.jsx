import { RefreshCw } from 'lucide-react'
import { EmptyState } from '../../../components/ui'

/**
 * A card whose source failed: the Cobalt empty state, the server's reason,
 * and a Retry that refetches that source only. The rest of the page stays.
 */
export default function CardFailed({ what, error, onRetry }) {
  return (
    <div className="accd-failed" role="alert">
      <EmptyState title={`Couldn’t load ${what}.`} hint={error} />
      <button type="button" className="btn" onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" /> Retry
      </button>
    </div>
  )
}
