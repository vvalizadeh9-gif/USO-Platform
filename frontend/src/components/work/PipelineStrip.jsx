import { useEffect, useRef } from 'react'
import Icon from '../Icon'
import { STEPS, stepSpokenName, tabId, volumeWidths } from '../../lib/pipelineSteps'
import { formatNumber } from '../../lib/numbers'

const GROUPS = [
  { id: 'hc', caption: 'Health check' },
  { id: 'dt', caption: 'Drive test' },
  { id: 'outcome', caption: 'Outcome' },
  { id: 'loop', caption: 'Side loops' },
]

/**
 * The Health check → Drive test pipeline as one strip (UEP-06 §3): six step
 * tiles, the DT done outcome and three side loops, in four groups.
 *
 * One tablist. Every tile and loop row is a tab with a roving tabindex; the
 * arrow keys move through them in strip order (Home and End jump) and moving
 * selects, which changes the URL. The selected tab is Home's hero tile.
 *
 * @param {{ summary: Record<string, {count:number, late:number}> | null, selected: string | null,
 *   onSelect: (step: object, viaKeyboard: boolean) => void, panelId: string, focusSelected?: boolean }} props
 */
export default function PipelineStrip({ summary, selected, onSelect, panelId, focusSelected }) {
  const listRef = useRef(null)
  const widths = volumeWidths(summary)

  // After a keyboard move that changed page, the new page focuses its tab.
  useEffect(() => {
    if (focusSelected && selected) document.getElementById(tabId(selected))?.focus()
  }, [focusSelected, selected])

  const onKeyDown = (event) => {
    const index = STEPS.findIndex((s) => s.key === selected)
    const last = STEPS.length - 1
    const next = {
      ArrowRight: index < 0 ? 0 : Math.min(last, index + 1),
      ArrowLeft: index < 0 ? 0 : Math.max(0, index - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const step = STEPS[next]
    document.getElementById(tabId(step.key))?.focus()
    if (step.key !== selected) onSelect(step, true)
  }

  const tab = (step) => {
    const figures = summary?.[step.key]
    const isSelected = step.key === selected
    return {
      id: tabId(step.key),
      role: 'tab',
      type: 'button',
      'aria-selected': isSelected,
      'aria-controls': panelId,
      'aria-label': stepSpokenName(step, figures),
      // Roving: only the selected tab is a tab stop (the first when none is).
      tabIndex: isSelected || (!selected && step === STEPS[0]) ? 0 : -1,
      onClick: () => !isSelected && onSelect(step, false),
      'data-step': step.key,
      figures,
      isSelected,
    }
  }

  return (
    <div className="uw-strip" role="tablist" aria-label="Site pipeline" ref={listRef} onKeyDown={onKeyDown}>
      {GROUPS.map((g) => (
        <div key={g.id} className={`uw-strip-group is-${g.id}`} role="presentation">
          <span className="uw-strip-caption" aria-hidden="true">{g.caption}</span>
          <div className="uw-strip-items" role="presentation">
            {STEPS.filter((s) => s.group === g.id).map((step) => {
              const { figures, isSelected, ...props } = tab(step)
              if (g.id === 'loop') return <LoopRow key={step.key} step={step} figures={figures} selected={isSelected} {...props} />
              return (
                <StepTile
                  key={step.key}
                  step={step}
                  figures={figures}
                  selected={isSelected}
                  width={widths[step.key]}
                  loading={summary == null}
                  {...props}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Figure({ figures, loading }) {
  if (loading) return <span className="uw-skel uw-skel-figure" aria-hidden="true" />
  if (!figures) return <span className="uw-tile-figure">–</span>
  return <span className="uw-tile-figure">{figures.count.toLocaleString('en-US')}</span>
}

function StepTile({ step, figures, selected, width, loading, ...props }) {
  const outcome = step.group === 'outcome'
  return (
    <button className={`uw-tile ${selected ? 'is-hero' : ''} ${outcome ? 'is-outcome' : ''}`.trim()} {...props}>
      <span className="uw-tile-label" aria-hidden="true">
        {outcome ? (
          <span className="uw-tile-done"><Icon name="checkmark" size={16} /></span>
        ) : (
          <span className="uw-tile-num">{step.number}</span>
        )}
        <span className="uw-tile-name">{step.short}</span>
      </span>
      <span className="uw-tile-line" aria-hidden="true">
        <Figure figures={figures} loading={loading} />
        {figures?.late > 0 && <span className="uw-tile-late">{figures.late.toLocaleString('en-US')} late</span>}
      </span>
      {outcome ? (
        <span className="uw-tile-meta" aria-hidden="true">To acceptance</span>
      ) : (
        <span className={`uw-tile-bar is-${step.group}`} aria-hidden="true">
          <i style={{ width: `${figures ? width : 0}%` }} />
        </span>
      )}
    </button>
  )
}

function LoopRow({ step, figures, selected, ...props }) {
  return (
    <button className={`uw-loop ${selected ? 'is-selected' : ''}`.trim()} {...props}>
      <span className="uw-loop-label" aria-hidden="true">{step.short}</span>
      {figures?.late > 0 && <span className="uw-loop-late" aria-hidden="true">{formatNumber(figures.late)} late</span>}
      <span className="uw-loop-count" aria-hidden="true">{figures ? figures.count.toLocaleString('en-US') : '–'}</span>
    </button>
  )
}
