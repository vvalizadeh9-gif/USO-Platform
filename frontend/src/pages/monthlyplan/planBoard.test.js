import { describe, expect, it } from 'vitest'
import { buildBoard, countWaiting, initials, streamState } from './planBoard'

const row = (id, name, status, over = {}) => ({
  contractor_id: id, contractor_name: name, plan_id: id * 10, status,
  committed_count: 10, in_force_count: null, previous_month_committed: null, assignment: 50, ...over,
})
const ready = (planning, running = { DT: { rows: [] }, ACCEPTANCE: { rows: [] } }) => ({ state: 'ready', planning, running })

describe('planBoard', () => {
  it('reads a Draft, or no plan, as not shared', () => {
    expect(streamState('Draft')).toBe('none')
    expect(streamState(null)).toBe('none')
    expect(streamState('Submitted')).toBe('waiting')
    expect(streamState('Returned')).toBe('returned')
    // A pending or returned revision leaves the approved number in force.
    expect(streamState('RevisionRequested')).toBe('approved')
    expect(streamState('RevisionReturned')).toBe('approved')
  })

  it('totals shared streams only, and counts nothing before the reads are in', () => {
    const board = ready({
      DT: { rows: [row(1, 'A', 'Submitted', { committed_count: 12 }), row(2, 'B', 'Draft', { committed_count: 99 })] },
      ACCEPTANCE: { rows: [row(1, 'A', 'Approved', { committed_count: 7, in_force_count: 7 })] },
    })
    const view = buildBoard(board)
    expect(view.totals).toEqual({ DT: 12, ACCEPTANCE: 7 })
    expect(view.shared.map((c) => c.name)).toEqual(['A'])
    expect(view.notShared.map((c) => c.name)).toEqual(['B'])
    expect(view.shared[0].word).toBe('1 waiting')
    expect(countWaiting(board)).toBe(1)
    expect(countWaiting({ state: 'loading' })).toBe(0)
  })

  it('takes the first two letters of a name', () => {
    expect(initials('Alpha Telecom')).toBe('Al')
    expect(initials('پارس ارتباط')).toBe('پا')
  })
})
