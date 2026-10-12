import { clock } from '../pages/home/homeLogic'

/** System status from GET /me/home's health check, data time and version.
 * Home's footer, shared by every page built on Home's frame. */
export default function AppFooter({ data, failed }) {
  const degraded = failed || data?.system?.status === 'degraded'
  return (
    <footer className="hf-footer">
      <span className={`hf-status ${degraded ? 'is-down' : ''}`.trim()} role="status">
        <i aria-hidden="true" />
        {degraded ? 'Some services are degraded' : 'All systems normal'}
      </span>
      {data?.generated_at && <span>Data as of {clock(new Date(data.generated_at))}</span>}
      <span className="hf-spacer" />
      {data?.version && <span>UEP {data.version}</span>}
    </footer>
  )
}
