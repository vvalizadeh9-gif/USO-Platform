import { describe, expect, it } from 'vitest'
import { DT_ASSIGNMENT_WAITING, HC_POOL_WAITING, waitingTone } from './waiting'

describe('waitingTone', () => {
  it('is grey under 4 days', () => {
    expect(waitingTone(0)).toBe('grey')
    expect(waitingTone(3)).toBe('grey')
  })

  it('is amber from 4 through 7 days', () => {
    expect(waitingTone(4)).toBe('amber')
    expect(waitingTone(7)).toBe('amber')
  })

  it('is red past 7 days', () => {
    expect(waitingTone(8)).toBe('red')
  })

  it('is grey when the day count is unknown', () => {
    expect(waitingTone(null)).toBe('grey')
    expect(waitingTone(undefined)).toBe('grey')
  })
})

describe('waitingTone: per-queue bands', () => {
  it('reads the HC Pool on a month scale: neutral to 30, pending 31-60, danger past 60', () => {
    expect(waitingTone(30, HC_POOL_WAITING)).toBe('grey')
    expect(waitingTone(31, HC_POOL_WAITING)).toBe('amber')
    expect(waitingTone(60, HC_POOL_WAITING)).toBe('amber')
    expect(waitingTone(61, HC_POOL_WAITING)).toBe('red')
  })

  it('reads DT Assignment by the week: neutral to 7, pending 8-14, danger past 14', () => {
    expect(waitingTone(7, DT_ASSIGNMENT_WAITING)).toBe('grey')
    expect(waitingTone(8, DT_ASSIGNMENT_WAITING)).toBe('amber')
    expect(waitingTone(14, DT_ASSIGNMENT_WAITING)).toBe('amber')
    expect(waitingTone(15, DT_ASSIGNMENT_WAITING)).toBe('red')
  })
})
