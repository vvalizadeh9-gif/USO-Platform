// The History table's arithmetic: the verdicts, what counts toward the
// totals, and that a missing plan is a dash rather than a zero.
import { describe, expect, it } from 'vitest'
import { contractorsOf, historyTable, percentOf, resultOf } from './history'

const month = (m, over = {}) => ({
  shamsi_month: m, shamsi_month_name: String(m), plan: 100, delivered: 100, internal: 120,
  is_running: false, is_future: false,
  contractors: [
    { id: 1, name: 'Beta', plan: 100, delivered: 90 },
    { id: 2, name: 'Alpha', plan: null, delivered: 10 },
  ],
  ...over,
})

describe('resultOf', () => {
  it('meets at 100%, is near from 80%, and below under it, on the exact share', () => {
    expect(resultOf(100, 100)).toBe('met')
    expect(resultOf(80, 100)).toBe('near')
    expect(resultOf(796, 1000)).toBe('below')
    expect(percentOf(796, 1000)).toBe(80)
  })

  it('gives no verdict and no share without a plan', () => {
    expect(resultOf(10, null)).toBeNull()
    expect(percentOf(10, null)).toBeNull()
  })
})

describe('historyTable', () => {
  const months = [
    month(1, { delivered: 70 }),
    month(2),
    month(3, { is_running: true, delivered: 5 }),
    month(4, { is_future: true, plan: null, delivered: null, internal: null, contractors: [] }),
  ]

  it('totals the completed months only and never judges the running one', () => {
    const { rows, totals } = historyTable(months)
    expect(rows.map((r) => r.result ?? (r.future ? 'future' : null))).toEqual(['below', 'met', 'running', 'future'])
    expect(totals).toEqual({ plan: 200, internal: 240, delivered: 170, pctPlan: 85, pctInternal: 71 })
  })

  it('reads one contractor without the Internal PIP, and a missing plan as null', () => {
    const beta = historyTable(months, 1)
    expect(beta.rows[0]).toMatchObject({ plan: 100, delivered: 90, internal: null, pctPlan: 90, result: 'near' })
    expect(beta.totals.internal).toBeNull()
    const alpha = historyTable(months, 2)
    expect(alpha.rows[0]).toMatchObject({ plan: null, delivered: 10, pctPlan: null, result: null })
    expect(alpha.totals).toMatchObject({ plan: null, delivered: 20, pctPlan: null })
  })

  it('lists the contractors the year names, alphabetical', () => {
    expect(contractorsOf(months)).toEqual([{ id: 2, name: 'Alpha' }, { id: 1, name: 'Beta' }])
  })
})
