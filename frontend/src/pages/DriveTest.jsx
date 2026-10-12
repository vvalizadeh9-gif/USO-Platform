import PipelinePage from './pipeline/PipelinePage'

/**
 * Drive test: steps 4–6 of the site pipeline, DT done and the Sent back loop
 * (UEP-06). The same page as Health check, on its own steps; see
 * pages/pipeline/PipelinePage.jsx and lib/pipelineSteps.js.
 */
export default function DriveTest() {
  return <PipelinePage page="dt" />
}
