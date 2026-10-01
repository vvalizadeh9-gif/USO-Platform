import { describe, expect, it } from 'vitest'
import vectors from './digitVectors.json'
import { toLatinDigits, toPersianDigits } from './persianDigits'

describe('persian digits', () => {
  it.each(vectors)('%s is stored as %s', (raw, latin) => {
    expect(toLatinDigits(raw)).toBe(latin)
  })

  it('displays Latin digits in Persian and round-trips', () => {
    expect(toPersianDigits('1405/ص/1920')).toBe('۱۴۰۵/ص/۱۹۲۰')
    expect(toLatinDigits(toPersianDigits('1405/04/11'))).toBe('1405/04/11')
  })
})
