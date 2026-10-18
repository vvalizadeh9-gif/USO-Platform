import { useEffect, useRef, useState } from 'react'
import { STRIP_STEPS, stepFigures, stepSpokenName, tabId } from '../../lib/pipelineSteps'
import { reducedMotion } from '../../lib/motionPreference'

const BANDS = [
  { id: 'hc', caption: 'Health check', note: 'Ready to Drive test · Problematic to Remediation' },
  { id: 'dt', caption: 'Drive test', note: 'Accept to DT done · Send back as Round 2' },
  { id: 'exceptions', caption: 'Exceptions' },
]

/** A figure that counts to its new value after an action (≤ 700 ms). */
function useCountTo(value) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (value == null) return undefined
    const start = from.current
    from.current = value
    if (start == null || start === value || reducedMotion()) {
      setShown(value)
      return undefined
    }
    let frame
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 600)
      setShown(Math.round(start + (value - start) * (1 - (1 - p) ** 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return shown
}

/**
 * The Drive test pipeline (UEP-14 §3.2): a Health check band (1 Assign →
 * 2 Checks), a Drive test band (3 Assign → 4 Tests) and an Exceptions box
 * (Remediation, DT done).
 *
 * One tablist. Every tile is a tab with a roving tabindex; the arrow keys
 * move through them in strip order (Home and End jump) and moving selects,
 * which changes the URL. The selected tile is filled in its stage colour.
 */
export default function PipelineStrip({ summary, selected, onSelect, panelId, focusSelected }) {
  useEffect(() => {
    if (focusSelected && selected) document.getElementById(tabId(selected))?.focus()
  }, [focusSelected, selected])

  const onKeyDown = (event) => {
    const index = STRIP_STEPS.findIndex((s) => s.key === selected)
    const last = STRIP_STEPS.length - 1
    const next = {
      ArrowRight: index < 0 ? 0 : Math.min(last, index + 1),
      ArrowLeft: index < 0 ? 0 : Math.max(0, index - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const step = STRIP_STEPS[next]
    document.getElementById(tabId(step.key))?.focus()
    if (step.key !== selected) onSelect(step, true)
  }

  return (
    <div className="uw-pipe" role="tablist" aria-label="Drive test pipeline" onKeyDown={onKeyDown}>
      {BANDS.map((band) => (
        <div key={band.id} className={`uw-pipe-band is-${band.id}`} role="presentation">
          <span className="uw-pipe-caption" aria-hidden="true">
            <b>{band.caption}</b>
            {band.note && <span>{band.note}</span>}
          </span>
          <div className="uw-pipe-steps" role="presentation">
            {STRIP_STEPS.filter((s) => s.band === band.id).map((step, i) => (
              <StepTile
                key={step.key}
                step={step}
                arrow={band.id !== 'exceptions' && i > 0}
                figures={stepFigures(step, summary)}
                loading={summary == null}
                selected={step.key === selected}
                tabbable={step.key === selected || (!selected && step === STRIP_STEPS[0])}
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

function StepTile({ step, arrow, figures, loading, selected, tabbable, panelId, onSelect }) {
  const count = useCountTo(figures?.count ?? null)
  const owning = step.owner === 'Owning teams'
  return (
    <>
      {arrow && <span className="uw-pipe-arrow" aria-hidden="true">→</span>}
      <button
        id={tabId(step.key)}
        role="tab"
        type="button"
        aria-selected={selected}
        aria-controls={panelId}
        aria-label={stepSpokenName(step, figures)}
        tabIndex={tabbable ? 0 : -1}
        data-step={step.key}
        className={`uw-pipe-tile is-${step.band} ${selected ? 'is-selected' : ''} ${owning ? 'is-owning' : ''}`.trim()}
        onClick={() => !selected && onSelect(step, false)}
      >
        <span className="uw-pipe-owner" aria-hidden="true">{step.owner}</span>
        <span className="uw-pipe-name" aria-hidden="true">
          {step.number && <span className="uw-pipe-num">{step.number}</span>}
          {step.short}
        </span>
        <span className="uw-pipe-line" aria-hidden="true">
          {loading ? (
            <span className="uw-skel uw-skel-figure" />
          ) : (
            <span className="uw-pipe-figure">{count == null ? '–' : count.toLocaleString('en-US')}</span>
          )}
          {figures?.decide > 0 && <span className="uw-pipe-decide">{figures.decide.toLocaleString('en-US')} to decide</span>}
          {figures?.late > 0 && <span className="uw-pipe-late">{figures.late.toLocaleString('en-US')} overdue</span>}
        </span>
      </button>
    </>
  )
}
