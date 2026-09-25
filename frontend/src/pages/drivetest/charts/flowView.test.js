import { describe, expect, it } from 'vitest'
import { flowNotes, labelledMonths } from './flowView'

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

describe('flowNotes', () => {
  const data = {
    opening: { on_air: 1000, dt_done: 900 },
    months: [
      { year: 1404, month: 1, on_aired: 20, dt_done: 30, is_open: false },
      { year: 1405, month: 1, on_aired: 10, dt_done: 5, is_open: true },
    ],
    not_placed: { on_air: 0, dt_done: 7 },
  }

  it('states where the cumulative scale starts, and the undated sites', () => {
    const notes = flowNotes(data, 'cumulative', null)
    // 907 done opens the chart (900 + the 7 undated); 85% of it is ~771,
    // and the round number under that is 500.
    expect(notes).toContain(
      'The running total starts from the opening balance on 1 Farvardin 1404. ' +
        'The scale starts at 500, not zero.',
    )
    expect(notes).toContain(
      '7 sites have no date to place them on the timeline, so they sit in the opening balance.',
    )
  })

  it('describes the year reading, which opens at zero and leaves undated sites out', () => {
    const notes = flowNotes(data, 'year', 1404)
    expect(notes).toContain('This counts only 1404, so its gap differs from the cumulative one.')
    expect(notes.join(' ')).not.toMatch(/scale starts/)
    expect(notes).toContain(
      '7 sites have no date to place them on the timeline, so they sit outside this year’s count.',
    )
  })
})
