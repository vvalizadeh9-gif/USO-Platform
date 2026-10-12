import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PipelineStrip from './PipelineStrip'

const SUMMARY = {
  hc1: { count: 196, late: 3 }, hc2: { count: 98, late: 0 }, hc3: { count: 12, late: 0 },
  dt4: { count: 49, late: 1 }, dt5: { count: 263, late: 4 }, dt6: { count: 7, late: 0 },
  done: { count: 1200, late: 0 }, remediation: { count: 9, late: 2 }, reroutes: { count: 0, late: 0 },
  sent_back: { count: 5, late: 0 },
}

const draw = (props = {}) =>
  render(<PipelineStrip summary={SUMMARY} selected="hc1" onSelect={vi.fn()} panelId="panel" {...props} />)

describe('the pipeline strip', () => {
  it('is one tablist with the steps, DT done and loops in order', () => {
    draw()
    expect(screen.getByRole('tablist', { name: 'Site pipeline' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.dataset.step)).toEqual([
      'hc1', 'hc2', 'hc3', 'dt4', 'dt5', 'dt6', 'done', 'remediation', 'reroutes', 'sent_back',
    ])
  })

  it('shows each count and says late in words', () => {
    draw()
    const tile = screen.getByRole('tab', { name: /^Step 1/ })
    expect(tile).toHaveTextContent('196')
    expect(tile).toHaveTextContent('3 late')
    expect(screen.getByRole('tab', { name: /^Step 2/ })).not.toHaveTextContent('late')
  })

  it('names each tab in a full sentence', () => {
    draw()
    expect(screen.getByRole('tab', { name: 'Step 5, In test: 263 sites, 4 late, with contractors' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'DT done: 1,200 sites, on to acceptance' })).toBeInTheDocument()
  })

  it('marks the selected step as the hero, with the only tab stop', () => {
    draw({ selected: 'dt5' })
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.dataset.step).toBe('dt5')
    expect(selected).toHaveClass('is-hero')
    expect(selected).toHaveAttribute('tabindex', '0')
    expect(selected).toHaveAttribute('aria-controls', 'panel')
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toHaveLength(1)
  })

  it('draws volume bars in proportion to the largest step', () => {
    const { container } = draw()
    const bar = (key) => container.querySelector(`[data-step="${key}"] .uw-tile-bar i`).style.width
    expect(bar('dt5')).toBe('100%')
    expect(parseFloat(bar('hc1'))).toBeCloseTo((100 * 196) / 263, 1)
    expect(bar('hc3')).not.toBe('0%')
    expect(container.querySelector('[data-step="hc1"] .uw-tile-bar')).toHaveClass('is-hc')
    expect(container.querySelector('[data-step="dt4"] .uw-tile-bar')).toHaveClass('is-dt')
  })

  it('moves with the arrows, Home and End, selecting as it goes', () => {
    const onSelect = vi.fn()
    draw({ selected: 'hc3', onSelect })
    const tab = screen.getByRole('tab', { selected: true })
    fireEvent.keyDown(tab, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'dt4' }), true)
    fireEvent.keyDown(tab, { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'hc2' }), true)
    fireEvent.keyDown(tab, { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'sent_back' }), true)
    fireEvent.keyDown(tab, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'hc1' }), true)
  })

  it('shows skeletons until the summary arrives', () => {
    const { container } = draw({ summary: null })
    expect(container.querySelectorAll('.uw-skel-figure').length).toBe(7)
  })
})
