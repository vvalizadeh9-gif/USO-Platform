// The two colour rules that would be wrong in a way nobody notices.
//
// A low-sample province taking the strongest green puts three villages at the
// top of a page people make decisions from; a rejected column coloured the
// ordinary way paints a province red for being refused *less* often than the
// rest of the country. Both are silent failures — the page still renders, the
// numbers are still right, and the colour says the opposite of what it means.
import { describe, expect, it } from 'vitest'
import {
  SHADES,
  STRONG_AT,
  cellShade,
  deltaTone,
  fmtDelta,
  fmtPct,
  importStamp,
} from './kpiTheme'

const cell = (delta, over = {}) => ({ pct: 50, delta, lower_is_better: false, ...over })

describe('cellShade', () => {
  it('deepens once a province is five or more points clear', () => {
    expect(cellShade(cell(4.9), false)).toBe(SHADES.better)
    expect(cellShade(cell(STRONG_AT), false)).toBe(SHADES.betterStrong)
    expect(cellShade(cell(-4.9), false)).toBe(SHADES.worse)
    expect(cellShade(cell(-STRONG_AT), false)).toBe(SHADES.worseStrong)
  })

  it('treats level with the country as the better side, not the worse', () => {
    expect(cellShade(cell(0), false)).toBe(SHADES.better)
  })

  it('never colours a low-sample province, however good it looks', () => {
    expect(cellShade(cell(40), true)).toBe(SHADES.none)
    expect(cellShade(cell(-40), true)).toBe(SHADES.none)
  })

  it('inverts the rejected columns, where lower is better', () => {
    // Nine points *more* rejection than the country is the bad direction.
    expect(cellShade(cell(9, { lower_is_better: true }), false)).toBe(SHADES.worseStrong)
    // Nine points less is the good one.
    expect(cellShade(cell(-9, { lower_is_better: true }), false)).toBe(SHADES.betterStrong)
  })

  it('leaves a cell with nothing to compare uncoloured', () => {
    expect(cellShade(cell(null), false)).toBe(SHADES.none)
    expect(cellShade(undefined, false)).toBe(SHADES.none)
  })
})

describe('deltaTone', () => {
  it('reads a rejected cell the same way its colour does', () => {
    expect(deltaTone(cell(6, { lower_is_better: true }))).toBe('down')
    expect(deltaTone(cell(-6, { lower_is_better: true }))).toBe('up')
    expect(deltaTone(cell(6))).toBe('up')
    expect(deltaTone(cell(null))).toBe('flat')
  })
})

describe('formatting', () => {
  it('shows an em dash where there is nothing to divide by', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtDelta(null)).toBe('—')
  })

  it('always signs a difference, so level reads as level', () => {
    expect(fmtDelta(0)).toBe('+0.0 pts')
    expect(fmtDelta(-3.25)).toBe('-3.3 pts')
    expect(fmtPct(76.45)).toBe('76.5%')
  })

  it('says so plainly when CPM has never been imported', () => {
    expect(importStamp(null)).toBe('No CPM import yet')
    expect(importStamp('not a date')).toBe('No CPM import yet')
  })
})
