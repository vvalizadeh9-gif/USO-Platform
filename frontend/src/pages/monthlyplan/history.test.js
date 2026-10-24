// The History page's arithmetic: gap and share per month, what counts toward
// the year, that a missing plan is a dash rather than a zero, and the order of
// the list.
import { describe, expect, it } from 'vitest'
import { BEHIND_PERCENT, contractorYear, contractorsOf, percentOf, shortMonthName, signedNumber, worstFirst } from './history'

const month = (m, over = {}) => ({
  shamsi_month: m, shamsi_month_name: String(m), plan: 100, delivered: 100, internal: 120,
  is_running: false, is_future: false,
  contractors: [
    { id: 1, name: 'Beta', plan: 100, delivered: 90 },
    { id: 2, name: 'Alpha', plan: null, delivered: 10 },
  ],
  ...over,
})

describe('percentOf', () => {
  it('rounds the share, and gives none without a plan', () => {
    expect(percentOf(796, 1000)).toBe(80)
    expect(percentOf(10, null)).toBeNull()
    expect(percentOf(10, 0)).toBeNull()
  })
})

describe('signedNumber', () => {
  it('uses a real minus, an explicit plus and ±0', () => {
    expect([signedNumber(5), signedNumber(-3), signedNumber(0)]).toEqual(['+5', '−3', '±0'])
  })

  it('names a month in three letters', () => {
    expect([1, 2, 8, 10, 12].map(shortMonthName)).toEqual(['فرو', 'ارد', 'آبا', 'دی', 'اسف'])
  })
})

describe('contractorYear', () => {
  const months = [
    month(1),
    month(2, { contractors: [{ id: 1, name: 'Beta', plan: 100, delivered: 40 }, { id: 2, name: 'Alpha', plan: null, delivered: 10 }] }),
    month(3, { is_running: true, contractors: [{ id: 1, name: 'Beta', plan: 100, delivered: 12 }] }),
    month(4, { is_future: true, delivered: null, contractors: [{ id: 1, name: 'Beta', plan: 110, delivered: 0 }] }),
    month(5, { is_future: true, delivered: null, contractors: [] }),
  ]

  it('gives gap and share for closed months, and judges neither the running month nor a month ahead', () => {
    const { rows, total } = contractorYear(months, 1)
    expect(rows.map((r) => [r.month, r.gap, r.pct])).toEqual([[1, -10, 90], [2, -60, 40], [3, null, null], [4, null, null], [5, null, null]])
    expect(rows[2]).toMatchObject({ running: true, actual: 12, pip: 100 })
    // Next month's planned PIP is kept; it has no actual.
    expect(rows[3]).toMatchObject({ future: true, pip: 110, actual: null })
    expect(rows[4]).toMatchObject({ pip: null, actual: null })
    // The year is the closed months only.
    expect(total).toEqual({ pip: 200, actual: 130, gap: -70, pct: 65 })
  })

  it('reads a missing plan as null, never 0, and still counts what was delivered', () => {
    const { rows, total } = contractorYear(months, 2)
    expect(rows[0]).toMatchObject({ pip: null, actual: 10, gap: null, pct: null })
    expect(total).toEqual({ pip: null, actual: 0, gap: null, pct: null })
  })

  it('carries the assignment for DT only, and only up to the running month', () => {
    const dt = contractorYear(months, 1, { 1: 7, 2: 7, 3: 8, 4: 9 })
    expect(dt.rows.map((r) => r.assigned)).toEqual([7, 7, 8, null, null])
    expect(contractorYear(months, 1).rows.map((r) => r.assigned)).toEqual([null, null, null, null, null])
  })

  it('knows where behind starts', () => {
    expect(BEHIND_PERCENT).toBe(85)
  })
})

describe('worstFirst', () => {
  it('orders contractors by the lower of their two shares, and a missing share last', () => {
    const dt = [
      month(1, {
        contractors: [
          { id: 1, name: 'Beta', plan: 100, delivered: 95 },
          { id: 2, name: 'Alpha', plan: 100, delivered: 90 },
          { id: 3, name: 'Carol', plan: null, delivered: 4 },
        ],
      }),
    ]
    const acceptance = [
      month(1, {
        contractors: [
          { id: 1, name: 'Beta', plan: 100, delivered: 60 },
          { id: 2, name: 'Alpha', plan: 100, delivered: 100 },
          { id: 3, name: 'Carol', plan: null, delivered: 4 },
        ],
      }),
    ]
    const list = worstFirst({ dt, acceptance })
    expect(list.map((p) => p.name)).toEqual(['Beta', 'Alpha', 'Carol'])
    expect(list[0].pct).toEqual({ dt: 95, acceptance: 60 })
    expect(list[2].pct).toEqual({ dt: null, acceptance: null })
  })

  it('lists the contractors the year names, alphabetical', () => {
    expect(contractorsOf([month(1)])).toEqual([{ id: 2, name: 'Alpha' }, { id: 1, name: 'Beta' }])
  })
})
