import { StepError } from '../../components/work/parts'
import AgingTiles from './AgingTiles'
import StepPath from './StepPath'
import VillageAcceptance from './VillageAcceptance'

/** The right card (UEP-11 §B5): aging, the step path, acceptance by village. */
export default function JourneyCard({ record, status, onRetry, highlight }) {
  return (
    <section className="hw-card ex-card ex-journey" aria-labelledby="ex-journey-title" aria-busy={status === 'loading' || undefined}>
      <header className="hw-head">
        <h2 id="ex-journey-title" className="ex-card-title">Journey</h2>
      </header>
      {status === 'error' ? (
        <StepError stepName="the journey" onRetry={onRetry} />
      ) : !record ? (
        <JourneySkeleton />
      ) : (
        <div className="ex-journey-body">
          <AgingTiles aging={record.journey.aging} steps={record.journey.steps} />
          <StepPath steps={record.journey.steps} />
          <VillageAcceptance
            villages={record.villages}
            counts={record.counts}
            started={record.acceptance_started}
            highlight={highlight}
          />
        </div>
      )}
    </section>
  )
}

/** Placeholders at the final size of each block. */
function JourneySkeleton() {
  return (
    <div className="ex-journey-body" aria-hidden="true">
      <div className="ex-aging">
        {[0, 1, 2, 3].map((i) => <span key={i} className="h-skel ex-skel-tile" />)}
      </div>
      <div className="ex-steps">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-skel ex-skel-step" />)}
      </div>
      <span className="h-skel ex-skel-block" />
    </div>
  )
}
