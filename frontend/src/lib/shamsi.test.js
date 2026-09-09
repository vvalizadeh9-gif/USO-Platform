// The one Shamsi conversion the browser does, and the list of month names it
// shares with ShamsiDate. Both are duplicated from core/jalali.py on purpose —
// the server's month name is what a response carries, and these decide labels
// and a default month, never a stored value.
import { describe, expect, it } from 'vitest'
import {
  SHAMSI_MONTHS,
  currentShamsiPeriod,
  periodLabel,
  previousPeriod,
  shamsiMonthName,
} from './shamsi'

describe('the month names', () => {
  it('has twelve, in order, matching core/jalali.SHAMSI_MONTHS', () => {
    expect(SHAMSI_MONTHS).toHaveLength(12)
    expect(SHAMSI_MONTHS[0]).toBe('فروردین')
    expect(SHAMSI_MONTHS[11]).toBe('اسفند')
  })

  it('names a month by number, one-based like the server', () => {
    expect(shamsiMonthName(1)).toBe('فروردین')
    expect(shamsiMonthName(6)).toBe('شهریور')
  })

  it('falls back to the number rather than showing undefined', () => {
    expect(shamsiMonthName(13)).toBe('13')
    expect(shamsiMonthName(undefined)).toBe('')
  })
})

describe('periodLabel', () => {
  it('reads as a month and a year', () => {
    expect(periodLabel(1405, 5)).toBe('مرداد 1405')
  })

  it('is empty rather than half a label when the period is not set', () => {
    expect(periodLabel(1405, null)).toBe('')
    expect(periodLabel(null, 5)).toBe('')
  })
})

describe('previousPeriod', () => {
  it('steps back a month', () => {
    expect(previousPeriod(1405, 6)).toEqual({ year: 1405, month: 5 })
  })

  // Mirrors jalali.previous_period, which is what the server uses to find
  // last month's approved figure.
  it('steps back a year at Farvardin', () => {
    expect(previousPeriod(1405, 1)).toEqual({ year: 1404, month: 12 })
  })
})

describe('currentShamsiPeriod', () => {
  it('converts a known date', () => {
    // 9 September 2026 is 18 Shahrivar 1405.
    expect(currentShamsiPeriod(new Date(2026, 8, 9, 12))).toEqual({ year: 1405, month: 6 })
  })

  it('answers for today, so the screen can open on the right month', () => {
    expect(currentShamsiPeriod()).not.toBeNull()
  })

  // A runtime without the Persian calendar hands back a Gregorian year
  // wearing a Shamsi label. Returning null makes the screen ask, which is
  // better than filing against a month nobody chose.
  it('is null rather than a Gregorian year in disguise', () => {
    const outOfRange = new Date(1980, 0, 1)
    expect(currentShamsiPeriod(outOfRange)).toBeNull()
  })
})
