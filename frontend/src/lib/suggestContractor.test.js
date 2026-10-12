import { describe, expect, it } from 'vitest'
import { coveredProvinces, orderContractors, suggestContractor } from './suggestContractor'

const c = (id, name, open, provinces) => ({
  contractor_id: id, name, open, late: 0, avg_submit_days: null,
  provinces: provinces.map((p) => ({ province: p, share: 0.5 })),
})

const PARS = c(1, 'پارس تل', 7, ['تهران', 'قم'])
const RAAD = c(2, 'رعد', 3, ['یزد'])
const ARIA = c(3, 'آریا موج', 2, ['تهران'])

describe('the suggested contractor', () => {
  it('covers the most provinces of the selected sites', () => {
    expect(suggestContractor([PARS, RAAD, ARIA], ['تهران', 'قم'])).toBe(PARS)
    expect(suggestContractor([PARS, RAAD, ARIA], ['یزد', 'یزد'])).toBe(RAAD)
  })

  it('breaks a tie with the lower open load', () => {
    expect(suggestContractor([PARS, RAAD, ARIA], ['تهران'])).toBe(ARIA)
  })

  it('is nobody when no one covers any of them', () => {
    expect(suggestContractor([PARS, RAAD, ARIA], ['کرمان'])).toBeNull()
    expect(suggestContractor([PARS], [])).toBeNull()
  })

  it('says which of the selected provinces it covers', () => {
    expect(coveredProvinces(PARS, ['تهران', 'کرمان', 'تهران'])).toEqual(['تهران'])
  })
})

describe('the order of the cards', () => {
  it('is lowest open load first', () => {
    expect(orderContractors([PARS, RAAD, ARIA]).map((x) => x.contractor_id)).toEqual([3, 2, 1])
  })

  it('puts the suggested contractor first', () => {
    expect(orderContractors([PARS, RAAD, ARIA], PARS).map((x) => x.contractor_id)).toEqual([1, 3, 2])
  })
})
