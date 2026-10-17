import { describe, expect, it } from 'vitest'
import { joinMeta } from './joinMeta'

describe('joinMeta', () => {
  it('joins present parts only', () => {
    expect(joinMeta('224 late', 'Oldest 89 days', '6 owners')).toBe('224 late · Oldest 89 days · 6 owners')
    expect(joinMeta('224 late', null, '')).toBe('224 late')
    expect(joinMeta(null, undefined)).toBe('')
  })
  it('never ends on a dot', () => {
    expect(joinMeta('a', '', null).endsWith('·')).toBe(false)
  })
})
