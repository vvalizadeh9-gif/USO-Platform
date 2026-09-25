import { describe, expect, it } from 'vitest'
import { fitScale, flowNotes, flowView, labelledMonths } from './flowView'

/** Months from Farvardin 1404, `n` of them, as the payload lists them. */
function monthsFrom1404(n) {
  return Array.from({ length: n }, (_, i) => ({
    year: 1404 + Math.floor(i / 12),
    month: (i % 12) + 1,
  }))
}

const sorted = (set) => [...set].sort((a, b) => a - b)

describe('labelledMonths', () => {
  // Full Persian month names collide one step apart, so the axis names every
  // third month. These pin how the latest month -- "now" -- is fitted in.

  it('names every third month, and the latest when it falls on one', () => {
    // Farvardin 1404 .. Mehr 1405: the latest (index 18) is on the rhythm.
    expect(sorted(labelledMonths(monthsFrom1404(19), 3, true))).toEqual([0, 3, 6, 9, 12, 15, 18])
  })

  it('adds the latest month when it sits two steps clear of the last label', () => {
    // Shahrivar 1405 is index 17; the last regular label is Tir at 15.
    expect(sorted(labelledMonths(monthsFrom1404(18), 3, true))).toEqual([
      0, 3, 6, 9, 12, 15, 17,
    ])
  })

  it('names the latest month instead of an ordinary label one step before it', () => {
    // Mordad 1405 is index 16; Tir at 15 would collide with it, so Tir gives way.
    expect(sorted(labelledMonths(monthsFrom1404(17), 3, true))).toEqual([0, 3, 6, 9, 12, 16])
  })

  it('keeps a Farvardin and its year over the latest month one step after it', () => {
    // Ordibehesht 1405 is index 13; Farvardin 1405 at 12 carries the year
    // caption, so it stays and the latest month is left to the readout.
    expect(sorted(labelledMonths(monthsFrom1404(14), 3, true))).toEqual([0, 3, 6, 9, 12])
  })

  it('does not protect Farvardin where no year caption is drawn', () => {
    // The single-year view draws no year line, so there is nothing to keep.
    const year = monthsFrom1404(10) // Farvardin .. Dey 1404, labelled every 2nd
    expect(sorted(labelledMonths(year, 2, false))).toEqual([0, 2, 4, 6, 9])
  })

  it('names every month when there is room for all of them', () => {
    expect(sorted(labelledMonths(monthsFrom1404(5), 1, false))).toEqual([0, 1, 2, 3, 4])
  })

  it('names nothing when there are no months', () => {
    expect(labelledMonths([], 3, true).size).toBe(0)
  })
})

describe('fitScale', () => {
  it('fits the scale to the values drawn, with a margin, on round steps', () => {
    // Lines from 1,800 to 3,083 used to sit on 1,000..4,000 -- about 40% of
    // the plot. Fitted, they use most of it.
    expect(fitScale([1800, 2400, 3083, 3032])).toEqual({ floor: 1500, ceiling: 3500 })
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

  it('shows every year as one running total from the opening balance', () => {
    const v = flowView(data, 'all')
    expect(totals(v)).toEqual([[53, 20], [63, 24], [71, 30], [76, 33], [80, 35]])
    expect(v.yearActivity).toBeNull()
  })

  it('zooms to a year without restarting the count', () => {
    // 1405 opens on the balance 1404 closed with, and every point is a real
    // running total -- the view this replaces started 1405 at 0/0.
    const v = flowView(data, 1405)
    expect(totals(v)).toEqual([[71, 30], [76, 33], [80, 35]])
    expect(v.months.map((m) => m.month)).toEqual([1, 2])
    expect(v.yearActivity).toEqual({ onAired: 9, dtDone: 5 })
  })

  it('opens the first year on the opening balance, undated sites included', () => {
    const v = flowView(data, 1404)
    expect(totals(v)).toEqual([[53, 20], [63, 24], [71, 30]])
    expect(v.yearActivity).toEqual({ onAired: 18, dtDone: 10 })
  })

  it('falls back to every year for a year the payload does not have', () => {
    expect(flowView(data, 1399).isAll).toBe(true)
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
    const notes = flowNotes(data, 'all')
    expect(notes).toContain(
      'The running total starts from the opening balance on 1 Farvardin 1404. ' +
        'The scale starts at 850, not zero.',
    )
    expect(notes).toContain(
      '7 sites have no date to place them on the timeline, so they sit in the opening ' +
        'balance, and so in every running total after it.',
    )
  })

  it('says a single year is the real running totals, not a restarted count', () => {
    const notes = flowNotes(data, 1405)
    expect(notes).toContain(
      'Showing 1405 only. These are the programme’s real running totals, carrying everything ' +
        'before 1405, so the gap is the real backlog at each month’s end. ' +
        'The scale starts at 900, not zero.',
    )
  })
})
