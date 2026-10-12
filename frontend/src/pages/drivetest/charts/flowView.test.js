import { describe, expect, it } from 'vitest'
import * as flowViewModule from './flowView'
import { fitScale, flowNotes, flowView, kpiSeries, monthChanges } from './flowView'

describe('fitScale', () => {
  it('fits the scale to the values drawn, with a margin, on round steps', () => {
    // Lines from 1,800 to 3,083 used to sit on 1,000..4,000 -- about 40% of
    // the plot. Fitted, they use most of it.
    expect(fitScale([1800, 2400, 3083, 3032])).toEqual({ floor: 1500, ceiling: 3500, step: 500 })
  })

  it('never goes below zero', () => {
    expect(fitScale([0, 5, 40]).floor).toBe(0)
  })

  it('still draws a scale for a flat series', () => {
    const { floor, ceiling } = fitScale([500, 500])
    expect(ceiling).toBeGreaterThan(floor)
    expect(floor).toBeLessThanOrEqual(500)
    expect(ceiling).toBeGreaterThanOrEqual(500)
  })
})

describe('flowView', () => {
  const data = {
    opening: { on_air: 50, dt_done: 20 },
    months: [
      { year: 1404, month: 1, on_aired: 10, dt_done: 4, is_open: false },
      { year: 1404, month: 2, on_aired: 8, dt_done: 6, is_open: false },
      { year: 1405, month: 1, on_aired: 5, dt_done: 3, is_open: false },
      { year: 1405, month: 2, on_aired: 4, dt_done: 2, is_open: true },
    ],
    not_placed: { on_air: 3, dt_done: 0 },
  }
  const totals = (v) => v.points.map((p) => [p.onAir, p.dtDone])

  it('draws every month cumulatively, from the opening balance, undated sites included', () => {
    const v = flowView(data)
    expect(v.months).toHaveLength(4)
    expect(totals(v)).toEqual([[53, 20], [63, 24], [71, 30], [76, 33], [80, 35]])
  })

  it('offers no other view: the scope switch and its helpers are gone', () => {
    for (const name of ['LAST_12', 'CUMULATIVE', 'flowYears', 'flowViewName', 'netChanges']) {
      expect(flowViewModule[name]).toBeUndefined()
    }
  })

  it('draws every month of a long programme, not the last twelve', () => {
    const long = {
      opening: { on_air: 100, dt_done: 40 },
      months: Array.from({ length: 19 }, (_, i) => ({
        year: 1404 + Math.floor(i / 12),
        month: (i % 12) + 1,
        on_aired: 1,
        dt_done: 0,
        is_open: i === 18,
      })),
    }
    const v = flowView(long)
    expect(v.months).toHaveLength(19)
    expect(v.points).toHaveLength(20)
    expect(v.points[0]).toMatchObject({ onAir: 100, dtDone: 40 })
  })

  it('fits the scale to both lines, so DT done above On air stays inside the plot', () => {
    // A year that cleared more than it brought on air -- and a running DT
    // done above the running On air -- must not push DT done off the top.
    const ahead = {
      opening: { on_air: 100, dt_done: 90 },
      months: [
        { year: 1404, month: 1, on_aired: 5, dt_done: 40, is_open: false },
        { year: 1404, month: 2, on_aired: 5, dt_done: 60, is_open: false },
        { year: 1405, month: 1, on_aired: 2, dt_done: 30, is_open: true },
      ],
      not_placed: { on_air: 0, dt_done: 0 },
    }
    const v = flowView(ahead)
    for (const p of v.points.slice(1)) {
      expect(p.dtDone).toBeGreaterThanOrEqual(v.floor)
      expect(p.dtDone).toBeLessThanOrEqual(v.ceiling)
      expect(p.onAir).toBeGreaterThanOrEqual(v.floor)
      expect(p.onAir).toBeLessThanOrEqual(v.ceiling)
    }
    expect(v.points.slice(1).some((p) => p.dtDone > p.onAir)).toBe(true)
  })

  it('labels the axis on round steps from the floor to the ceiling', () => {
    const v = flowView(data)
    expect(v.ticks[0]).toBe(v.floor)
    expect(v.ticks[v.ticks.length - 1]).toBe(v.ceiling)
    const steps = v.ticks.slice(1).map((t, i) => t - v.ticks[i])
    expect(new Set(steps).size).toBe(1)
  })

  it('gives each month its own changes, measured from the point before', () => {
    const v = flowView(data)
    expect(v.changes).toEqual([
      { onAir: 10, dtDone: 4, gap: 6 },
      { onAir: 8, dtDone: 6, gap: 2 },
      { onAir: 5, dtDone: 3, gap: 2 },
      { onAir: 4, dtDone: 2, gap: 2 },
    ])
    expect(monthChanges(v.points)).toEqual(v.changes)
    // The gap changes telescope to the movement across the whole chart.
    const sum = v.changes.reduce((a, c) => a + c.gap, 0)
    expect(sum).toBe(v.points.at(-1).gap - v.points[0].gap)
  })
})

describe('flowNotes', () => {
  const data = {
    opening: { on_air: 1000, dt_done: 900 },
    months: [
      { year: 1404, month: 1, on_aired: 20, dt_done: 30, is_open: false },
      { year: 1405, month: 1, on_aired: 10, dt_done: 5, is_open: true },
    ],
    not_placed: { on_air: 0, dt_done: 7 },
  }

  it('states where the running total starts, where the scale starts, and the undated sites', () => {
    const notes = flowNotes(data)
    expect(notes).toContain('Sites on air against drive tests done, every month since Farvardin 1404.')
    expect(notes).toContain(
      'The lines are the programme’s running totals, carried from the opening balance on ' +
        '1 Farvardin 1404, so the gap is the real backlog at each month’s end. The scale ' +
        'starts at 900, not zero.',
    )
    expect(notes).toContain(
      '7 sites have no date to place them on the timeline, so they sit in the opening ' +
        'balance, and so in every running total after it.',
    )
  })

  it('points at the readout, not at a row of badges under the chart', () => {
    const text = flowNotes(data).join(' ')
    expect(text).toMatch(/readout beside the key shows the latest month/)
    expect(text).not.toMatch(/Under each month/)
  })
})

describe('kpiSeries', () => {
  // Nineteen months, so the sparklines' last twelve are a window onto the
  // cumulative series, not the whole of it.
  const data = {
    opening: { on_air: 100, dt_done: 40 },
    months: Array.from({ length: 19 }, (_, i) => ({
      year: 1404 + Math.floor(i / 12),
      month: (i % 12) + 1,
      on_aired: 10 + i,
      dt_done: 7 + (i % 3),
      is_open: i === 18,
    })),
  }

  it('is the last twelve points of the cumulative series the chart draws', () => {
    const s = kpiSeries(data)
    const drawn = flowView(data).points.slice(1).slice(-12)
    expect(s.onAir).toHaveLength(12)
    expect(s.onAir).toEqual(drawn.map((p) => p.onAir))
    expect(s.dtDone).toEqual(drawn.map((p) => p.dtDone))
    // The last point is the chart's last point, so the tiles and the chart
    // agree on the current figure.
    expect(s.onAir.at(-1)).toBe(flowView(data).points.at(-1).onAir)
  })

  it('reconciles: Pending is On air minus DT done for every point', () => {
    const s = kpiSeries(data)
    s.pending.forEach((v, i) => expect(v).toBe(s.onAir[i] - s.dtDone[i]))
  })

  it("carries the current month's on-air change, from the same points", () => {
    const s = kpiSeries(data)
    expect(s.onAirThisMonth).toBe(28)
    expect(s.onAirThisMonth).toBe(s.onAir.at(-1) - s.onAir.at(-2))
  })

  it('has nothing to draw for a deployment with no activity', () => {
    expect(kpiSeries({ opening: { on_air: 0, dt_done: 0 }, months: [] })).toBeNull()
  })
})
