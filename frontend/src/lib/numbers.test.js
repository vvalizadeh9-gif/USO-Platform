import { describe, expect, it } from 'vitest'
import { formatNumber } from './numbers'

describe('formatNumber', () => {
  it('puts a comma between thousands', () => {
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(2500000)).toBe('2,500,000')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(-12345)).toBe('-12,345')
  })

  it('keeps up to two decimals', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(formatNumber(1234.567)).toBe('1,234.57')
  })

  it('passes through what is not a number', () => {
    expect(formatNumber('—')).toBe('—')
    expect(formatNumber('1405')).toBe('1405')
    expect(formatNumber(Number.NaN)).toBeNaN()
  })

  it('writes a missing value as the fallback', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined, '')).toBe('')
  })
})
