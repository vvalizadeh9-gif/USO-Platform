import { describe, expect, it } from 'vitest'
import {
  orderVillages,
  openVillages,
  pillText,
  sideChip,
  sideLine,
  siteBadge,
  stepAccessibleName,
  stepDateText,
  workflowActions,
} from './explorerModel'
import { VILLAGES, side, village } from './fixtures'

const as = (role) => ({ role: { name: role } })

describe('orderVillages', () => {
  it('puts rejections first, then more pending sides, then the longest wait, approved last', () => {
    const approved = village('V1', side('approved'), side('approved'))
    const oneShort = village('V2', side('pending', { days: 2 }), side('approved'))
    const oneLong = village('V3', side('pending', { days: 9 }), side('approved'))
    const twoPending = village('V4', side('pending', { days: 1 }), side('pending', { days: 1 }))
    const rejected = village('V5', side('rejected'), side('approved'))
    expect(orderVillages([approved, oneShort, oneLong, twoPending, rejected]).map((v) => v.code)).toEqual([
      'V5', 'V4', 'V3', 'V2', 'V1',
    ])
  })

  it('counts open villages as those not fully approved', () => {
    expect(openVillages(VILLAGES).map((v) => v.code)).toEqual(['V10002', 'V10003'])
  })
})

describe('the step path', () => {
  it('reads the aging pill, never negative, "so far" on the open step', () => {
    expect(pillText({ state: 'done', gap_days: 7 })).toBe('+7 d')
    expect(pillText({ state: 'in_progress', gap_days: 8 })).toBe('+8 d so far')
    expect(pillText({ state: 'done', gap_days: null })).toBe('—')
  })

  it('shows "No date" for an undated done step and "In progress" for the open one', () => {
    expect(stepDateText({ state: 'done', date: null })).toBe('No date')
    expect(stepDateText({ state: 'done', date: '2026-10-06' })).toBe('6 Oct 2026')
    expect(stepDateText({ state: 'in_progress', date: null })).toBe('In progress')
  })

  it('names each step with its state and date', () => {
    expect(stepAccessibleName({ key: 'dt_done', state: 'done', date: '2026-09-30', gap_days: 14 })).toBe(
      'DT done: done, 30 Sept 2026, 14 days after the previous step',
    )
    expect(stepAccessibleName({ key: 'acceptance', state: 'in_progress', gap_days: 1 })).toBe('Acceptance: in progress, 1 day so far')
  })

  it('badges the site by its current step', () => {
    expect(siteBadge({ step: 'acceptance', state: 'in_progress' })).toEqual({ label: 'Acceptance in progress', tone: 'progress' })
    expect(siteBadge({ step: 'acceptance', state: 'done' })).toEqual({ label: 'Acceptance done', tone: 'done' })
  })
})

describe('a side’s line', () => {
  it('reads each state in Gregorian dates', () => {
    expect(sideLine(side('approved', { decided_date: '2026-10-06', days: 4 }), 'ICT')).toBe('6 Oct 2026, took 4 days')
    expect(sideLine(side('rejected', { decided_date: '2026-10-02' }), 'ICT')).toBe('2 Oct 2026, not re-filed yet')
    expect(sideLine(side('pending', { filed_date: '2026-10-07' }), 'CRA')).toBe('Answer filed 7 Oct 2026, with coordinator')
    expect(sideLine(side('pending', { filed_date: '2026-10-10', days: 1, refiled: true }), 'ICT')).toBe('Re-filed 10 Oct 2026, waiting 1 day')
    expect(sideLine(side('pending', { phase: 'with_authority', filed_date: '2026-10-01', days: 13 }), 'CRA')).toBe(
      'With CRA since 1 Oct 2026, waiting 13 days',
    )
    expect(sideLine(side('pending', { phase: 'returned', decided_date: '2026-10-04' }), 'ICT')).toBe('Returned 4 Oct 2026, needs a new letter')
    expect(sideLine(side('pending', { phase: 'not_filed' }), 'ICT')).toBe('Not filed yet')
  })

  it('shows the word only when the data has no date', () => {
    expect(sideLine(side('approved'), 'ICT')).toBeNull()
    expect(sideLine(side('rejected'), 'ICT')).toBeNull()
  })

  it('chips a re-filed or returned side', () => {
    expect(sideChip(side('pending', { refiled: true }))).toBe('Re-filed')
    expect(sideChip(side('pending', { phase: 'returned' }))).toBe('Returned')
    expect(sideChip(side('pending'))).toBeNull()
  })
})

describe('workflowActions', () => {
  it('offers each old form where the old page did', () => {
    expect(workflowActions(as('Coordinator'), { current_stage: 'Ready for Assignment' }).assign).toBe(true)
    expect(workflowActions(as('Coordinator'), { current_stage: 'DT Done' }).assign).toBe(false)
    expect(workflowActions(as('PM'), { current_stage: 'Assigned' })).toMatchObject({ submitDt: true, returnToCoordinator: false })
    expect(workflowActions(as('Contractor'), { current_stage: 'Assigned' })).toMatchObject({ submitDt: true, returnToCoordinator: true })
    expect(workflowActions(as('PM'), { current_stage: 'DT Submitted', active_drive_test_id: 3 }).review).toBe(true)
    expect(Object.values(workflowActions(as('Viewer'), { current_stage: 'Assigned' })).some(Boolean)).toBe(false)
  })
})
