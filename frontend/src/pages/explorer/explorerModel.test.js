import { describe, expect, it } from 'vitest'
import {
  decisionLine,
  orderVillages,
  openVillages,
  sideChip,
  sideLine,
  siteBadge,
  stageCell,
  workflowActions,
} from './explorerModel'
import { VILLAGES, side, village } from './fixtures'
import { userWithAccess } from '../../test/seededAccess'

const as = (role) => userWithAccess({ role: { name: role } })

describe('orderVillages', () => {
  it('puts rejected first, then pending, then approved -- the worse side decides -- then village code', () => {
    const approved = village('V1', side('approved'), side('approved'))
    const pendingB = village('V3', side('pending', { days: 9 }), side('approved'))
    const pendingA = village('V2', side('approved'), side('pending', { days: 2 }))
    const rejected = village('V5', side('approved'), side('rejected'))
    expect(orderVillages([approved, pendingB, pendingA, rejected]).map((v) => v.code)).toEqual(['V5', 'V2', 'V3', 'V1'])
  })

  it('counts open villages as those not fully approved', () => {
    expect(openVillages(VILLAGES).map((v) => v.code)).toEqual(['V10002', 'V10003'])
  })
})

describe('the badge', () => {
  it('names the open step in the agreed words, and acceptance done in green', () => {
    const words = ['health_check', 'assigned', 'dt_done', 'sent_to_ict', 'acceptance'].map(
      (step) => siteBadge({ step, state: 'in_progress' }).label,
    )
    expect(words).toEqual([
      'Health check in progress', 'Awaiting assignment', 'Drive test in progress',
      'Awaiting submission to ICT', 'Acceptance in progress',
    ])
    expect(siteBadge({ step: 'acceptance', state: 'done' })).toEqual({ label: 'Acceptance done', tone: 'done' })
  })
})

describe('the stage cell', () => {
  it('reads the open step, its days and, only over the SLA, late', () => {
    expect(stageCell({ stage: 'dt_done', stage_days: 14, stage_late: true })).toMatchObject({
      label: 'Drive test', days: 14, late: true, name: 'Drive test, 14 days, over SLA',
    })
    expect(stageCell({ stage: 'assigned', stage_days: 1, stage_late: false }).name).toBe('Assignment, 1 day')
    expect(stageCell({ stage: 'health_check', stage_days: null, stage_late: false }).name).toBe('Health check')
  })

  it('fills the bar by steps done out of six, the open step after them', () => {
    expect(stageCell({ stage: 'sent_to_ict', stage_days: 3 })).toMatchObject({ filled: 4 / 6, open: 1 / 6 })
    expect(stageCell({ stage: 'on_air', stage_days: null })).toMatchObject({ filled: 0, label: 'On air' })
  })

  it('says Accepted with no days once every village is approved', () => {
    expect(stageCell({ stage: 'done', stage_days: null })).toMatchObject({ done: true, label: 'Accepted', days: null, filled: 1 })
    expect(stageCell({ stage: null })).toBeNull()
  })
})

describe('a side’s line', () => {
  it('shows dates only, never an age', () => {
    expect(sideLine(side('approved', { decided_date: '2026-11-15', days: 4 }))).toBe('15 Nov 2026')
    expect(sideLine(side('rejected', { decided_date: '2026-11-13' }))).toBe('13 Nov 2026, not re-filed yet')
    expect(sideLine(side('pending', { filed_date: '2026-11-17', days: 1, refiled: true }))).toBe('Re-filed 17 Nov 2026')
    expect(sideLine(side('pending', { filed_date: '2026-11-20', days: 7 }))).toBe('Filed 20 Nov 2026')
    expect(sideLine(side('pending', { phase: 'with_authority', filed_date: '2026-10-01', days: 13 }))).toBe('Filed 1 Oct 2026')
    expect(sideLine(side('pending', { phase: 'not_filed' }))).toBe('Not filed yet')
  })

  it('shows the word only when the data has no date', () => {
    expect(sideLine(side('approved'))).toBeNull()
    expect(sideLine(side('rejected'))).toBeNull()
  })

  it('tags a re-filed or returned side', () => {
    expect(sideChip(side('pending', { refiled: true }))).toBe('Re-filed')
    expect(sideChip(side('pending', { phase: 'returned' }))).toBe('Returned')
    expect(sideChip(side('pending'))).toBeNull()
  })
})

describe('the history panel’s status line', () => {
  it('says who applied or ignored a change, and when', () => {
    const base = { kind: 'removed', decided_by: 'Sara Ahmadi', decided_at: '2026-11-19' }
    expect(decisionLine({ ...base, status: 'applied' })).toBe('Applied by Sara Ahmadi on 19 Nov 2026')
    expect(decisionLine({ ...base, status: 'ignored' })).toBe('Ignored by Sara Ahmadi on 19 Nov 2026 · still on this site')
    expect(decisionLine({ ...base, kind: 'added', status: 'ignored' })).toBe('Ignored by Sara Ahmadi on 19 Nov 2026')
    expect(decisionLine({ kind: 'added', status: 'pending' })).toBe('Waiting for the PM')
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
