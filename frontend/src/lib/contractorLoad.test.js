import { describe, expect, it } from 'vitest'
import { dtLoadByContractor, hcLoadByContractor } from './contractorLoad'

describe('hcLoadByContractor', () => {
  it('sums pending sites per contractor and counts the late ones past fourteen days', () => {
    const load = hcLoadByContractor([
      { contractor_id: 1, sites_pending: 8, days_outstanding: 20 },
      { contractor_id: 1, sites_pending: 6, days_outstanding: 14 },
      { contractor_id: 2, sites_pending: 3, days_outstanding: 2 },
      { contractor_id: null, sites_pending: 9, days_outstanding: 40 },
    ])
    expect(load.get(1)).toEqual({ open: 14, late: 8 })
    expect(load.get(2)).toEqual({ open: 3, late: 0 })
    expect(load.size).toBe(2)
  })
})

describe('dtLoadByContractor', () => {
  it('counts one open drive test per site', () => {
    const load = dtLoadByContractor([{ contractor_id: 4 }, { contractor_id: 4 }, { contractor_id: 5 }])
    expect(load.get(4)).toEqual({ open: 2, late: 0 })
    expect(load.get(5)).toEqual({ open: 1, late: 0 })
  })
})
