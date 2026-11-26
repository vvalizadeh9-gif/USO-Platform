import { describe, expect, it } from 'vitest'
import {
  ageBar, cardSections, caseMeta, changeOf, compactCount, groupByDay, legendParts, metaText, openUrl,
  rowCount, submissionMeta, ticketParts, todoParts, unitFor,
} from './homeLogic'

const TOTALS = { todo: 20, todo_late: 4, todo_due_soon: 6, todo_on_time: 10, todo_no_date: 0 }
const ticket = (over) => ({ queue_key: 'q', holder: 'self', count: 10, late: 2, due_soon: 3, on_time: 4, no_date: 1, ...over })

describe('the To do bar (UEP-27)', () => {
  it('has a part per status with items, in bar order, sized by count', () => {
    expect(todoParts(TOTALS).map((p) => [p.key, p.count])).toEqual([['late', 4], ['due_soon', 6], ['on_time', 10]])
  })

  it('keeps every status in the legend except No date at zero', () => {
    expect(legendParts(TOTALS).map((p) => p.key)).toEqual(['late', 'due_soon', 'on_time'])
    expect(legendParts({ ...TOTALS, todo_no_date: 3, todo_late: 0 }).map((p) => p.key)).toEqual(['late', 'due_soon', 'on_time', 'no_date'])
  })

  it('words a change, red only when it went the wrong way', () => {
    expect(changeOf(12)).toEqual({ text: '12 vs 7 days ago', dir: 'up', worse: true })
    expect(changeOf(-3)).toEqual({ text: '3 vs 7 days ago', dir: 'down', worse: false })
    expect(changeOf(0).text).toBe('No change vs 7 days ago')
    expect(changeOf(null)).toBeNull()
    expect(changeOf(-5, { vs: 'vs last week', upIsWorse: false })).toMatchObject({ worse: true, text: '5 vs last week' })
  })
})

describe('a queue row (UEP-27)', () => {
  it('draws a strip of its own four parts, zero parts left out', () => {
    expect(ticketParts(ticket({ due_soon: 0 })).map((p) => p.key)).toEqual(['late', 'on_time', 'no_date'])
  })

  it('shows only the filtered part, and 0 for rows someone else holds', () => {
    expect(rowCount(ticket(), null)).toBe(10)
    expect(rowCount(ticket(), 'late')).toBe(2)
    expect(rowCount(ticket({ holder: 'others' }), 'late')).toBe(0)
    expect(rowCount(ticket({ holder: 'others' }), 'waiting')).toBe(10)
    expect(rowCount(ticket(), 'waiting')).toBe(0)
  })

  it('splits a card into the viewer’s rows (reminder last) and Waiting on others', () => {
    const s = cardSections([
      ticket({ queue_key: 'mojri', holder: 'reminder', count: 1 }),
      ticket({ queue_key: 'ict', holder: 'others' }),
      ticket({ queue_key: 'dt' }),
      ticket({ queue_key: 'empty', count: 0 }),
    ])
    expect(s.mine.map((t) => t.queue_key)).toEqual(['dt', 'mojri'])
    expect(s.theirs.map((t) => t.queue_key)).toEqual(['ict'])
  })

  it('agrees its unit with its number', () => {
    expect(unitFor(1, 'sites')).toBe('site')
    expect(unitFor(2, 'villages')).toBe('villages')
    expect(unitFor(1, 'fixes')).toBe('fix')
  })
})

describe('the list panel (UEP-27)', () => {
  it('puts the SLA tick at the middle of a track twice the SLA long', () => {
    expect(ageBar({ status: 'on_time', age_days: 7, sla_days: 14 })).toEqual({ width: 25, tick: 50 })
    expect(ageBar({ status: 'late', age_days: 60, sla_days: 14 })).toEqual({ width: 100, tick: 50 })
    expect(ageBar({ status: 'no_date', age_days: null, sla_days: null })).toEqual({ width: 100, tick: null })
  })

  it('writes app badges in "1k" style above 999', () => {
    expect(compactCount(999)).toBe('999')
    expect(compactCount(1450)).toBe('1k')
  })

  it('carries the filter and search to the queue page', () => {
    expect(openUrl('/drive-test?tab=assign', { status: 'late', q: ' TEH ' })).toBe('/drive-test?tab=assign&status=late&q=TEH')
    expect(openUrl('/filing', { status: 'all', q: '' })).toBe('/filing')
  })

  it('groups this week’s acts by day, newest first, today named', () => {
    const now = new Date(2026, 10, 26, 12)
    const groups = groupByDay([
      { id: 'a', closed_at: new Date(2026, 10, 26, 9).toISOString() },
      { id: 'b', closed_at: new Date(2026, 10, 24, 9).toISOString() },
    ], now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Tuesday'])
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

describe('Submissions rows on Home (UEP-21)', () => {
  const row = (due) => ({ queue_key: 'submit_to_ict', count: 64, submission: { next_number: 40, due_in: due, sites: 41, oldest_days: null } })
  it('says the batch, its due date and the sites', () => {
    expect(submissionMeta(row(5))).toEqual({ due: 'Batch #40 due in 5 days', tone: null, text: '41 sites' })
    expect(submissionMeta(row(3)).tone).toBe('pending')
    expect(submissionMeta(row(-1))).toMatchObject({ due: 'Batch #40 overdue 1 day', tone: 'danger' })
  })
  it('says late and oldest for the follow-up row', () => {
    const t = { queue_key: 'ict_mojri_follow_up', count: 9, submission: { next_number: 40, due_in: 3, sites: 0, oldest_days: 41 } }
    expect(submissionMeta(t)).toEqual({ late: 9, text: 'Oldest 41 days' })
  })
  it('leaves every other row alone', () => {
    expect(submissionMeta({ queue_key: 'ict_pending', count: 3 })).toBeNull()
  })
})


describe('caseMeta (UEP-22)', () => {
  it('says over SLA and no comment, and nothing for other rows', () => {
    expect(caseMeta({ acceptance: { count: 9, over_sla: 3, no_comment: 2 } })).toEqual({ overSla: '3 over SLA', noComment: '2 no comment' })
    expect(caseMeta({ acceptance: { count: 9, over_sla: 0, no_comment: 0 } })).toEqual({ overSla: null, noComment: null })
    expect(caseMeta({ queue_key: 'hc_assign' })).toBeNull()
  })
})
