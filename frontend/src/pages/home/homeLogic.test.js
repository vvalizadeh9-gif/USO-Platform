import { describe, expect, it } from 'vitest'
import { deltaText, deltaTone, metaText, weekDelta } from './homeLogic'

describe('KPI delta', () => {
  it('words the change', () => {
    expect(deltaText(13)).toBe('↑ 13 vs last week')
    expect(deltaText(-3)).toBe('↓ 3 vs last week')
    expect(deltaText(0)).toBe('No change')
    expect(deltaText(null)).toBeNull()
  })

  it('is danger only when the change is bad, and never good', () => {
    expect(deltaTone('pending', 2)).toBe('bad')
    expect(deltaTone('overdue', -2)).toBe('neutral')
    expect(deltaTone('dueSoon', 1)).toBe('bad')
    expect(deltaTone('done', -1)).toBe('bad')
    expect(deltaTone('done', 5)).toBe('neutral')
    expect(deltaTone('pending', 0)).toBe('neutral')
  })

  it('compares today with seven days ago', () => {
    expect(weekDelta([1, 2, 3, 4, 5, 6, 7, 10])).toBe(9)
    expect(weekDelta([null, 2, 3, 4, 5, 6, 7, 10])).toBeNull()
    expect(weekDelta([1, 2])).toBeNull()
  })
})

describe('queue meta line', () => {
  it('counts owners, never names them', () => {
    const t = { oldest_days: 21, owners_total: 5, owner_type: 'contractors', owners: ['A', 'B'] }
    expect(metaText(t)).toBe('Oldest 21 days · 5 contractors')
    expect(metaText({ ...t, owners_total: 1 })).toBe('Oldest 21 days · 1 contractor')
    expect(metaText({ oldest_days: 1, owners_total: 0, owner_type: null })).toBe('Oldest 1 day')
  })
})
