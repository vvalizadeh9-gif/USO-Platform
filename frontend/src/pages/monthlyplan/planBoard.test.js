import { describe, expect, it } from 'vitest'
import { buildApprovals, buildBoard, countWaiting, initials, monthLabel, runningFigures, streamState } from './planBoard'

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
    // A stream nobody read (ICT, CRA here) totals 0: nothing shared.
    expect(view.totals).toEqual({ DT: 12, ACCEPTANCE: 7, ICT: 0, CRA: 0 })
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

  it('makes one approval card per waiting contractor, red lines only when true', () => {
    const board = ready(
      {
        DT: {
          rows: [
            row(1, 'A', 'Submitted', { committed_count: 60, assignment: 50, previous_month_committed: 40, submitted_at: '2026-10-01T08:00:00Z' }),
            row(2, 'B', 'Approved', { committed_count: 20, in_force_count: 20 }),
            row(3, 'C', 'Returned'),
          ],
        },
        ACCEPTANCE: { rows: [row(1, 'A', 'Submitted', { plan_id: 99, committed_count: 30, submitted_at: '2026-10-02T08:00:00Z' })] },
      },
      {
        DT: { rows: [row(4, 'D', 'RevisionRequested', { plan_id: 70, committed_count: 12, in_force_count: 15, revision_reason: 'PERMITS' })] },
        ACCEPTANCE: { rows: [] },
      },
    )
    const running = {
      dt: { rows: [{ contractor_id: 1, pip: 40, delivered: 10, pace_diff: 3 }, { contractor_id: 4, pip: 15, delivered: 2, pace_diff: -6 }] },
      acceptance: { rows: [{ contractor_id: 1, pip: 20, delivered: 2, pace_diff: -4 }] },
    }
    const { cards, decided } = buildApprovals(board, running)
    expect(cards.map((c) => [c.kind, c.name])).toEqual([['plan', 'A'], ['revision', 'D']])
    const [a, d] = cards
    expect(a.submittedAt).toBe('2026-10-02T08:00:00Z')
    expect(a.blocks).toEqual([
      { stream: 'DT', planId: 10, number: 60, compare: 40, above: 10, behind: null },
      { stream: 'ACCEPTANCE', planId: 99, number: 30, compare: null, above: null, behind: 4 },
    ])
    expect(d.blocks[0]).toMatchObject({ planId: 70, number: 12, compare: 15, reason: 'PERMITS', above: null, behind: 6 })
    // In the board's order: sent back before approved.
    expect(decided).toEqual([
      { id: 3, name: 'C', state: 'returned' },
      { id: 2, name: 'B', state: 'approved' },
    ])
  })

  it('reads nobody as behind before the running month is in', () => {
    expect(runningFigures(null, 'DT', 1)).toBeNull()
    expect(runningFigures({ dt: { rows: [{ contractor_id: 1, pip: null, delivered: 0, pace_diff: null }] } }, 'DT', 1))
      .toEqual({ pip: null, delivered: 0, behind: null })
  })

  it('labels a month in Persian digits', () => {
    expect(monthLabel({ year: 1405, month: 8 })).toBe('آبان ۱۴۰۵')
    expect(monthLabel(null)).toBe('')
  })
})
