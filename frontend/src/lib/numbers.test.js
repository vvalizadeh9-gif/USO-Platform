import { describe, expect, it } from 'vitest'
import { formatCount, formatNumber } from './numbers'

describe('formatNumber', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1,000'],
    [2500000, '2,500,000'],
    [1234567890, '1,234,567,890'],
    [-1000, '-1,000'],
    [1234.5, '1,234.5'],
  ])('writes %s as %s', (value, expected) => {
    expect(formatNumber(value)).toBe(expected)
  })

  it('reads numeric text as a number', () => {
    expect(formatNumber('2500000')).toBe('2,500,000')
  })

  it.each([null, undefined, '', 'abc', NaN, Infinity])('reads %s as no value, never "NaN"', (value) => {
    expect(formatNumber(value)).toBe('—')
  })

  it('lets the caller choose what no value reads as', () => {
    expect(formatNumber(null, { fallback: '0' })).toBe('0')
  })

  it('rounds to the digits asked for', () => {
    expect(formatNumber(1234.5678, { maximumFractionDigits: 1 })).toBe('1,234.6')
    expect(formatNumber(1234.5678, { maximumFractionDigits: 0 })).toBe('1,235')
  })

  it('writes Latin digits whatever the browser language is', () => {
    expect(formatNumber(1234567)).toMatch(/^[0-9,]+$/)
  })
})

describe('formatCount', () => {
  it('pluralises on the number, not on its text', () => {
    expect(formatCount(1, 'site')).toBe('1 site')
    expect(formatCount(0, 'site')).toBe('0 sites')
    expect(formatCount(1204, 'site')).toBe('1,204 sites')
    expect(formatCount(2, 'category', 'categories')).toBe('2 categories')
  })
})
