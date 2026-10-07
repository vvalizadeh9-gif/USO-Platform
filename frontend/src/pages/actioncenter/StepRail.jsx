import { Check, Plus } from 'lucide-react'
import { STEPS, stepHeadingId } from './stages'

/**
 * The lifecycle, drawn once: a numbered marker per step on a line that ends
 * at "Accepted", each with its step's heading and what waits there. Pinned
 * under the PageBar while the board scrolls (amendment G). Plans & Data
 * runs alongside the line rather than on it.
 */
export default function StepRail({ steps, loading }) {
  const lifecycle = STEPS.filter((s) => !s.alongside)
  const alongside = STEPS.filter((s) => s.alongside)
  return (
    <div className="ac-rail ac-grid">
      <span className="ac-rail-line" aria-hidden="true" />
      {lifecycle.map((step, i) => (
        <Step key={step.key} step={step} index={i} summary={steps?.[step.key]} loading={loading} />
      ))}
      <div className="ac-step ac-step-end">
        <span className="ac-marker ac-marker-end" style={{ '--ac-i': lifecycle.length }} aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
        <span className="ac-step-end-name">Accepted</span>
        <span className="ac-step-sub">End of lifecycle</span>
      </div>
      {alongside.map((step) => (
        <Step
          key={step.key}
          step={step}
          index={lifecycle.length + 1}
          summary={steps?.[step.key]}
          loading={loading}
        />
      ))}
    </div>
  )
}

function Step({ step, index, summary, loading }) {
  return (
    <div className="ac-step" data-stage={step.key}>
      <div className="ac-step-marker-row">
        <span
          className={step.alongside ? 'ac-marker ac-marker-alongside' : 'ac-marker'}
          style={{ '--ac-i': index }}
          aria-hidden="true"
        >
          {step.alongside ? <Plus size={14} strokeWidth={2.5} /> : index + 1}
        </span>
        {step.alongside && <span className="ac-step-alongside">Runs alongside</span>}
      </div>
      <h2 className="ac-step-name" id={stepHeadingId(step.key)}>{step.name}</h2>
      <p className="ac-step-sub">{loading ? 'Loading…' : stepSummary(summary)}</p>
    </div>
  )
}

function stepSummary(summary) {
  if (!summary || summary.pending === 0) return 'Nothing waiting on you'
  // Each half stays on one line; a narrow column breaks between them.
  return (
    <>
      <span className="ac-nowrap">{summary.pending} pending</span> ·{' '}
      <span className="ac-nowrap">{summary.overdue} overdue</span>
    </>
  )
}
