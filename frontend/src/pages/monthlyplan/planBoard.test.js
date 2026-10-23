import { describe, expect, it } from 'vitest'
import { buildBoard, buildPlans, countWaiting, decidedValue, initials, isChanged, monthLabel, planCell, streamKpi, streamState } from './planBoard'

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

  it('reads a returned plan as not filed, and a revision on an approved plan as approved', () => {
    expect(planCell(row(1, 'A', 'Returned')).state).toBe('notFiled')
    expect(planCell(row(1, 'A', 'Draft')).state).toBe('notFiled')
    expect(planCell(undefined).state).toBe('notFiled')
    expect(planCell(row(1, 'A', 'RevisionRequested', { in_force_count: 30 }))).toMatchObject({ state: 'approved', number: 30, asked: 30 })
    expect(planCell(row(1, 'A', 'Submitted', { committed_count: 40 }))).toMatchObject({ state: 'waiting', number: 40, asked: 40 })
  })

  it('keeps what was asked beside a number the PM changed', () => {
    const changed = planCell(
      row(1, 'A', 'Approved', { committed_count: 18, in_force_count: 18, asked_count: 25, decision_comment: 'Too high' }),
    )
    expect(changed).toMatchObject({ state: 'approved', number: 18, asked: 25, changedFrom: 25, comment: 'Too high' })
    expect(planCell(row(1, 'A', 'Approved', { committed_count: 18, in_force_count: 18 }))).toMatchObject({
      asked: 18,
      changedFrom: null,
    })
  })

  it('groups contractors by what they need, oldest waiting first', () => {
    const board = ready(
      {
        DT: {
          rows: [
            row(1, 'Zed', 'Submitted', { submitted_at: '2026-10-02T08:00:00Z' }),
            row(2, 'Amir', 'Submitted', { submitted_at: '2026-10-03T08:00:00Z' }),
            row(3, 'Bita', 'Approved', { in_force_count: 10 }),
            row(4, 'Cyrus', 'Returned'),
          ],
        },
        ACCEPTANCE: {
          rows: [
            row(1, 'Zed', 'Submitted', { submitted_at: '2026-10-01T08:00:00Z' }),
            row(2, 'Amir', 'Draft'),
            row(3, 'Bita', 'Approved', { in_force_count: 10 }),
            row(4, 'Cyrus', null, { plan_id: null }),
          ],
        },
        ICT: { rows: [row(5, 'Eli', 'Submitted')] },
      },
      {
        DT: { rows: [row(6, 'Dara', 'RevisionRequested', { in_force_count: 15 })] },
        ACCEPTANCE: { rows: [] },
      },
    )
    const plans = buildPlans(board)
    // Zed's Acceptance plan has waited longest, though Amir's DT plan is newer.
    expect(plans.groups.decision.map((c) => c.name)).toEqual(['Zed', 'Amir'])
    expect(plans.groups.notFiled.map((c) => c.name)).toEqual(['Cyrus'])
    expect(plans.groups.decided.map((c) => c.name)).toEqual(['Bita'])
    expect(plans.revisions.map((r) => [r.name, r.stream])).toEqual([['Dara', 'DT']])
    expect(plans.other.map((o) => [o.name, o.stream])).toEqual([['Eli', 'ICT']])
  })

  it('totals what was asked and what stands after the decisions', () => {
    const board = ready({
      DT: {
        rows: [
          row(1, 'A', 'Submitted', { committed_count: 40 }),
          row(2, 'B', 'Approved', { committed_count: 30, in_force_count: 30 }),
          row(3, 'C', 'Returned', { committed_count: 99 }),
        ],
      },
      ACCEPTANCE: { rows: [row(1, 'A', 'Submitted', { plan_id: 91, committed_count: 20 })] },
    })
    const plans = buildPlans(board)
    const a = plans.contractors.find((c) => c.name === 'A').cells.DT
    expect(decidedValue(a, {})).toBe(40)
    expect(isChanged(a, {})).toBe(false)

    const same = streamKpi(plans, 'DT', {}, 150)
    // C's returned plan is not submitted, so it is in no total.
    expect(same).toMatchObject({ submitted: 2, total: 3, asked: 70, after: 70, change: 0, approved: 30, waiting: 40, toCover: 80 })
    expect(same.dots).toEqual([true, true, false])

    const lower = { [a.planId]: { value: 33 } }
    expect(isChanged(a, lower)).toBe(true)
    expect(streamKpi(plans, 'DT', lower, 150)).toMatchObject({ asked: 70, after: 63, change: -7, waiting: 33, toCover: 87 })
    expect(streamKpi(plans, 'DT', { [a.planId]: { value: 200 } }, 150).toCover).toBe(-80)
    expect(streamKpi(plans, 'DT', {}, null).toCover).toBeNull()
  })

  it('labels a month in Persian digits', () => {
    expect(monthLabel({ year: 1405, month: 8 })).toBe('آبان ۱۴۰۵')
    expect(monthLabel(null)).toBe('')
  })
})
