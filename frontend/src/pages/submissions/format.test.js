import { describe, expect, it } from 'vitest'
import { REASONS, batchStatus, cycleText, mojriState, splitWidths, viewFrom, villageStatus } from './format'

describe('Submissions words (UEP-21)', () => {
  it('reads the view from ?view=, Ready by default', () => {
    expect(viewFrom('')).toBe('ready')
    expect(viewFrom('?view=follow-up')).toBe('follow-up')
    expect(viewFrom('?view=nonsense')).toBe('ready')
  })

  it('lists the reasons in the side panel order, with their tiles', () => {
    expect(REASONS.map((r) => r.id)).toEqual(['all', 'new_dt', 'missed', 'became_target', 'resend'])
    expect(REASONS.find((r) => r.id === 'new_dt')).toMatchObject({ icon: 'data--check', tile: '--uep-app-drive-test' })
  })

  it('never uses a green tone', () => {
    const tones = [
      ...['draft', 'sent', 'follow_up', 'closed'].map((s) => batchStatus(s).tone),
      ...['in_mojri', 'waiting', 'follow_up', 'resent'].map((s) => mojriState(s).tone),
    ]
    expect(tones.every((t) => ['neutral', 'accent', 'pending', 'danger'].includes(t))).toBe(true)
  })

  it('splits a batch into In Mojri / Waiting / Follow up widths', () => {
    expect(splitWidths({ in_mojri: 1, waiting: 2, follow_up: 1 })).toEqual({
      inMojri: '25%', waiting: '50%', followUp: '25%', pct: 25,
    })
    expect(splitWidths(null)).toBeNull()
  })

  it('words the cycle: pending at 3 days or fewer, danger when overdue', () => {
    expect(cycleText({ day: 11, days: 14, due_in: 3 })).toMatchObject({ pct: 79, due: 'Due in 3 days', tone: 'pending' })
    expect(cycleText({ day: 16, days: 14, due_in: -2 })).toMatchObject({ pct: 100, due: 'Overdue 2 days', tone: 'danger' })
    expect(cycleText({ day: 2, days: 14, due_in: 12 }).tone).toBeNull()
    expect(cycleText(null).due).toBe('No batch sent yet')
  })

  it("words a coordinator's village status", () => {
    expect(villageStatus({ status: 'in_draft', batch_number: 40 }).label).toBe('In draft #40')
    expect(villageStatus({ status: 'waiting', batch_number: 39 }).label).toBe('Sent #39 · waiting Mojri')
    expect(villageStatus({ status: 'follow_up', days: 41 })).toEqual({ tone: 'danger', label: 'Follow up · 41 days' })
  })
})
