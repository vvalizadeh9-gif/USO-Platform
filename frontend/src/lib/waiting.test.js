import { describe, expect, it } from 'vitest'
import { waitingTone } from './waiting'

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
