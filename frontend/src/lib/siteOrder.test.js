import { describe, expect, it } from 'vitest'
import { isLate, orderSites } from './siteOrder'

const r = (code, province, days) => ({ site_code: code, province, days_waiting: days })
const ROWS = [r('A', 'قم', 5), r('B', 'تهران', 9), r('C', 'قم', 30), r('D', 'تهران', 12), r('E', 'یزد', null)]

describe('site order', () => {
  it('is longest waiting first, an unknown wait last', () => {
    expect(orderSites(ROWS, false).map((x) => x.site_code)).toEqual(['C', 'D', 'B', 'A', 'E'])
  })

  it('by province: provinces by their longest wait, then sites by wait', () => {
    expect(orderSites(ROWS, true).map((x) => x.site_code)).toEqual(['C', 'A', 'D', 'B', 'E'])
  })

  it('is late only past the SLA', () => {
    expect(isLate(14, 14)).toBe(false)
    expect(isLate(15, 14)).toBe(true)
    expect(isLate(null, 14)).toBe(false)
    expect(isLate(40, null)).toBe(false)
  })
})
