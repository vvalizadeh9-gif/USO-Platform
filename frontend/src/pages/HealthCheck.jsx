import PipelinePage from './pipeline/PipelinePage'

/**
 * Health check: steps 1–3 of the site pipeline and the Remediation and
 * Re-routes loops (UEP-06). The same page as Drive test, on its own steps;
 * see pages/pipeline/PipelinePage.jsx and lib/pipelineSteps.js for the URLs,
 * including the legacy `?tab=basket`, `results`, `dt-assign` and `dt-review`.
 */
export default function HealthCheck() {
  return <PipelinePage page="hc" />
}
