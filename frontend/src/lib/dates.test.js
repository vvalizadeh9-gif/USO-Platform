import { describe, expect, it } from 'vitest'
import { daysBetween, formatLong, fromIso, toIso, todayIso } from './dates'

describe('fromIso', () => {
  it('parses a real date', () => {
    const d = fromIso('2026-09-08')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 8])
  })

  it('lands on the local calendar day, not the UTC one', () => {
    // The bug this guards: parsing through Date('2026-09-08') gives UTC
    // midnight, which is the previous calendar day for anyone west of
    // Greenwich. Asserted as the day rather than the hour, because in a zone
    // that springs forward at midnight the local day starts at 01:00.
    expect(toIso(fromIso('2026-09-08'))).toBe('2026-09-08')
  })

  it('refuses a day that does not exist rather than rolling it forward', () => {
    expect(fromIso('2026-02-31')).toBeNull()
    expect(fromIso('2025-02-29')).toBeNull()
    expect(fromIso('2026-13-01')).toBeNull()
    expect(fromIso('2026-00-10')).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    expect(fromIso('2024-02-29')).not.toBeNull()
    expect(fromIso('2000-02-29')).not.toBeNull()
  })

  it('refuses 29 February in a century that is not a leap year', () => {
    expect(fromIso('1900-02-29')).toBeNull()
  })

  it('refuses anything that is not the ISO shape', () => {
    for (const bad of ['', null, undefined, '8/9/2026', '2026-9-8', '2026-09-08T00:00', 'today']) {
      expect(fromIso(bad)).toBeNull()
    }
  })
})

describe('toIso', () => {
  it('zero-pads month and day', () => {
    expect(toIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('round-trips with fromIso', () => {
    for (const iso of ['2026-09-08', '2024-02-29', '1999-12-31', '2026-01-01']) {
      expect(toIso(fromIso(iso))).toBe(iso)
    }
  })
})

describe('todayIso', () => {
  it('agrees with the local calendar day, not the UTC one', () => {
    const now = new Date()
    expect(todayIso()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    )
  })
})

describe('formatLong', () => {
  it('spells the month out so 09-08 cannot be read two ways', () => {
    expect(formatLong('2026-09-08')).toBe('8 September 2026')
  })

  it('is empty for a date it cannot parse', () => {
    expect(formatLong('nonsense')).toBe('')
  })
})

describe('daysBetween', () => {
  it('counts backwards from today to an earlier date', () => {
    expect(daysBetween('2026-09-08', '2026-09-01')).toBe(7)
  })

  it('is negative for a future date', () => {
    expect(daysBetween('2026-09-08', '2026-09-10')).toBe(-2)
  })

  it('crosses a month and a leap day without drifting', () => {
    expect(daysBetween('2024-03-01', '2024-02-28')).toBe(2)
  })

  it('is null when either side is unparseable', () => {
    expect(daysBetween('2026-09-08', 'x')).toBeNull()
    expect(daysBetween(null, '2026-09-08')).toBeNull()
  })
})
