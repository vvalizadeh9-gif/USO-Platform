import { describe, expect, it } from 'vitest'
import { fitScale, flowNotes, flowView, netChanges } from './flowView'

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

  it('opens on the latest year, its months only, carrying the running total', () => {
    const v = flowView(data)
    expect(v.selected).toBe(1405)
    expect(v.months.map((m) => `${m.year}-${m.month}`)).toEqual(['1405-1', '1405-2'])
    // points[0] is where 1405 opened -- the running total through Esfand
    // 1404, not zero -- and one point per month after it. The last one is
    // the KPI cards' figure: 53 + 27 on air, 20 + 15 done.
    expect(totals(v)).toEqual([[71, 30], [76, 33], [80, 35]])
  })

  it('draws the first year from the opening balance, undated sites included', () => {
    const v = flowView(data, 1404)
    expect(v.months.map((m) => `${m.year}-${m.month}`)).toEqual(['1404-1', '1404-2'])
    expect(totals(v)).toEqual([[53, 20], [63, 24], [71, 30]])
  })

  it('stops at the year picked, carrying every year before it', () => {
    // A third year the two-year fixture above can't show: picking the middle
    // one must carry 1404 forward and still stop before 1406.
    const threeYears = {
      opening: { on_air: 50, dt_done: 20 },
      months: [
        ...data.months,
        { year: 1406, month: 1, on_aired: 6, dt_done: 1, is_open: true },
      ],
      not_placed: { on_air: 3, dt_done: 0 },
    }
    const v = flowView(threeYears, 1405)
    expect(totals(v)).toEqual([[71, 30], [76, 33], [80, 35]])
    expect(v.months.map((m) => m.year)).toEqual([1405, 1405])
  })

  it('falls back to the latest year for a year the payload does not have', () => {
    expect(flowView(data, 1399).selected).toBe(1405)
  })

  it('labels the axis on round steps from the floor to the ceiling', () => {
    const v = flowView(data)
    expect(v.ticks[0]).toBe(v.floor)
    expect(v.ticks[v.ticks.length - 1]).toBe(v.ceiling)
    const steps = v.ticks.slice(1).map((t, i) => t - v.ticks[i])
    expect(new Set(steps).size).toBe(1)
  })

  it("gives each month its own change in the gap, measured from where the year opened", () => {
    // 1405 opened on a gap of 41; +2 and +2 take it to 45.
    expect(netChanges(flowView(data).points)).toEqual([2, 2])
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
    expect(notes).toContain(
      'Showing 1405, month by month. The lines are the programme’s running totals, carried ' +
        'from the opening balance on 1 Farvardin 1404, so the gap is the real backlog at each ' +
        'month’s end. The scale starts at 900, not zero.',
    )
    expect(notes).toContain(
      '7 sites have no date to place them on the timeline, so they sit in the opening ' +
        'balance, and so in every running total after it.',
    )
  })

  it('says the lines carry the running total, not a count restarted for the year', () => {
    const notes = flowNotes(data, 1404)
    expect(notes.join(' ')).toMatch(/Showing 1404, month by month\. The lines are the programme’s running totals, carried from the opening balance/)
  })
})
