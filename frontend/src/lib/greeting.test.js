import { describe, expect, it } from 'vitest'
import { daysSince, daysUntil, greetingFor, gregorianLabel } from './greeting'

// Tehran is UTC+03:30 all year (no daylight saving since 2022).
const tehran = (hh, mm = 0) => new Date(Date.UTC(2026, 9, 9, hh, mm) - 3.5 * 3600 * 1000)

describe('greetingFor', () => {
  it.each([
    [4, 59, 'Good evening'],
    [5, 0, 'Good morning'],
    [11, 59, 'Good morning'],
    [12, 0, 'Good afternoon'],
    [17, 59, 'Good afternoon'],
    [18, 0, 'Good evening'],
  ])('at %i:%i in Tehran says %s', (hh, mm, expected) => {
    expect(greetingFor(tehran(hh, mm))).toBe(expected)
  })
})

describe('gregorianLabel', () => {
  it('names the day in Tehran, not the browser', () => {
    expect(gregorianLabel(tehran(9))).toBe('Friday, 9 October 2026')
    // 00:30 on the 10th in Tehran is still the 9th in UTC.
    expect(gregorianLabel(tehran(24, 30))).toBe('Saturday, 10 October 2026')
  })
})

describe('day counts', () => {
  const now = Date.UTC(2026, 9, 9, 12)
  it('counts whole days since, never below zero', () => {
    expect(daysSince(new Date(now - 21.5 * 86400000).toISOString(), now)).toBe(21)
    expect(daysSince(new Date(now + 3600000).toISOString(), now)).toBe(0)
  })
  it('counts days until, rounding up', () => {
    expect(daysUntil(new Date(now + 2.2 * 86400000).toISOString(), now)).toBe(3)
  })
})
