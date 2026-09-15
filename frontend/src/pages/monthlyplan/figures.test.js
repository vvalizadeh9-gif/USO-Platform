// The arithmetic the PIP screen does for itself.
//
// Small, and worth pinning: one decides where the chart's gridlines land, and
// the other decides whether a month reads as a failure or as a month nobody
// set a target for.
import { describe, expect, it } from 'vitest'
import { axisScale, sharePercent } from './figures'

describe('axisScale', () => {
  it('ends on a number the gridlines can divide', () => {
    for (const highest of [1, 3, 7, 12, 38, 76, 101, 240, 999]) {
      const { max, step } = axisScale(highest)
      expect(max).toBe(step * 4)
      expect(max).toBeGreaterThanOrEqual(highest)
      // Every gridline is a whole number of drive tests.
      expect(Number.isInteger(step)).toBe(true)
    }
  })

  it('gives an empty month an axis rather than dividing by zero', () => {
    expect(axisScale(0).max).toBeGreaterThan(0)
  })
})

describe('sharePercent', () => {
  it('is null when there is no PIP to be a share of', () => {
    // Not 0%: a contractor with no approved plan has not achieved none of it.
    expect(sharePercent(0, null)).toBeNull()
    expect(sharePercent(12, 0)).toBeNull()
  })

  it('goes past 100 for a month that beat its target', () => {
    expect(sharePercent(45, 38)).toBe(118)
  })

  it('rounds to whole percentage points', () => {
    expect(sharePercent(24, 38)).toBe(63)
    expect(sharePercent(22, 50)).toBe(44)
  })
})
