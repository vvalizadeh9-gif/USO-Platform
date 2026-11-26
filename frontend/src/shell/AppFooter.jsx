import Icon from '../components/Icon'
import { clock, shortDate } from '../pages/home/homeLogic'

/** System status from GET /me/home's health check, data time and version.
 * Home's footer, shared by every page built on Home's frame. */
export default function AppFooter({ data, failed }) {
  // UEP-25: the System health verdict -- the same one Admin › Overview and
  // the System health page show: "All systems normal" or the first problem.
  const status = failed ? 'degraded' : data?.system?.status || 'normal'
  const problem = status !== 'normal'
  const text = failed
    ? 'Some services are degraded'
    : data?.system?.headline || (problem ? 'Some services are degraded' : 'All systems normal')
  return (
    <footer className="hf-footer">
      <span className={`hf-status ${problem ? 'is-down' : ''}`.trim()} role="status">
        {/* A real health check (UEP-13 §3.14f): a Carbon mark, no dot. */}
        <Icon name={problem ? 'warning--alt' : 'checkmark--outline'} size={14} />
        {text}
      </span>
      {/* UEP-27: how old the rollout list is, and when these figures were read. */}
      {data?.cpm_imported_at && <span data-testid="footer-cpm">CPM data from {shortDate(data.cpm_imported_at)}</span>}
      {data?.generated_at && <span>Updated {clock(new Date(data.generated_at))}</span>}
      <span className="hf-spacer" />
      {data?.version && <span>UEP {data.version}</span>}
    </footer>
  )
}
