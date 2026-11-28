import { useEffect, useState } from 'react'
import Icon from '../Icon'
import { STRIP_STEPS, stepFigures, stepSpokenName, tabId } from '../../lib/pipelineSteps'
import { reducedMotion } from '../../lib/motionPreference'

const GROUPS = [
  { id: 'hc', caption: 'Health check' },
  { id: 'dt', caption: 'Drive test' },
  { id: 'exceptions', caption: 'Exceptions' },
]

/** DT done is an outcome: shown, never selected. */
const TABS = STRIP_STEPS.filter((s) => s.key !== 'done')

/** The figures count up from 0 the first time the strip is drawn, once per
 * visit to the app (UEP-31 §1.8); after that they change in place. */
let countedUp = false

function useCountUp(value) {
  const [shown, setShown] = useState(() => (value == null || countedUp || reducedMotion() ? value : 0))
  useEffect(() => {
    if (value == null) return undefined
    if (countedUp || reducedMotion()) {
      setShown(value)
      return undefined
    }
    let frame
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 700)
      setShown(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
      else countedUp = true
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return shown
}

/**
 * The Drive test flow (UEP-31 §1.3): one quiet card in three groups --
 * Health check (1 · Assign → 2 · Checks), Drive test (3 · Assign → 4 · Tests)
 * and Exceptions (Remediation, DT done). The selected step has no fill: its
 * label turns dark and a line in the stage colour grows under it.
 *
 * One tablist with a roving tabindex; the arrow keys move through the steps
 * (Home and End jump) and moving selects, which changes the URL.
 */
export default function PipelineStrip({ summary, selected, onSelect, panelId, focusSelected }) {
  useEffect(() => {
    if (focusSelected && selected) document.getElementById(tabId(selected))?.focus()
  }, [focusSelected, selected])

  const onKeyDown = (event) => {
    const index = TABS.findIndex((s) => s.key === selected)
    const last = TABS.length - 1
    const next = {
      ArrowRight: index < 0 ? 0 : Math.min(last, index + 1),
      ArrowLeft: index < 0 ? 0 : Math.max(0, index - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const step = TABS[next]
    document.getElementById(tabId(step.key))?.focus()
    if (step.key !== selected) onSelect(step, true)
  }

  return (
    <div className="uw-flow" role="tablist" aria-label="Drive test pipeline" onKeyDown={onKeyDown}>
      {GROUPS.map((group) => (
        <div key={group.id} className={`uw-flow-group is-${group.id}`} role="presentation">
          <span className="uw-flow-caption" aria-hidden="true">{group.caption}</span>
          <div className="uw-flow-steps" role="presentation">
            {STRIP_STEPS.filter((s) => s.band === group.id).map((step, i) => (
              <FlowStep
                key={step.key}
                step={step}
                chevron={group.id !== 'exceptions' && i > 0}
                figures={stepFigures(step, summary)}
                loading={summary == null}
                selected={step.key === selected}
                tabbable={step.key === selected || (!selected && step === TABS[0])}
                panelId={panelId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function FlowStep({ step, chevron, figures, loading, selected, tabbable, panelId, onSelect }) {
  const count = useCountUp(figures?.count ?? null)
  const done = step.key === 'done'
  const body = (
    <>
      <span className="uw-flow-label" aria-hidden={done ? undefined : 'true'}>
        {done && <Icon name="checkmark--filled" size={16} className="uw-flow-done" />}
        {step.number ? `${step.number} · ${step.short}` : step.short}
      </span>
      <span className="uw-flow-line" aria-hidden={done ? undefined : 'true'}>
        {loading ? (
          <span className="uw-skel uw-skel-figure" />
        ) : (
          <span className="uw-flow-figure">{count == null ? '–' : count.toLocaleString('en-US')}</span>
        )}
        {figures?.decide > 0 && <span className="uw-flow-decide">{figures.decide.toLocaleString('en-US')} to decide</span>}
        {figures?.late > 0 && <span className="uw-flow-late">{figures.late.toLocaleString('en-US')} late</span>}
      </span>
    </>
  )
  return (
    <>
      {chevron && <Icon name="chevron--right" size={16} className="uw-flow-chevron" />}
      {done ? (
        <div className="uw-flow-step is-done" data-step={step.key}>{body}</div>
      ) : (
        <button
          id={tabId(step.key)}
          role="tab"
          type="button"
          aria-selected={selected}
          aria-controls={panelId}
          aria-label={stepSpokenName(step, figures)}
          tabIndex={tabbable ? 0 : -1}
          data-step={step.key}
          className={`uw-flow-step is-${step.band} ${selected ? 'is-selected' : ''}`.trim()}
          onClick={() => !selected && onSelect(step, false)}
        >
          {body}
        </button>
      )}
    </>
  )
}
