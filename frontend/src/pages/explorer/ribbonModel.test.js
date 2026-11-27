// The journey ribbon's geometry (UEP-28 §B4).
import { describe, expect, it } from 'vitest'
import { RIBBON, allocate, daysBetween, layoutRibbon, ribbonSummary } from './ribbonModel'
import { record } from './fixtures'

const steps = (states) => {
  const keys = ['on_air', 'health_check', 'assigned', 'dt_done', 'sent_to_ict', 'acceptance']
  const dates = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-30', '2026-10-06', '2026-11-21']
  const gaps = [null, 7, 7, 14, 6, 46]
  return keys.map((key, i) => ({
    key,
    state: states[i],
    date: states[i] === 'done' ? dates[i] : null,
    gap_days: states[i] === 'upcoming' ? null : gaps[i],
  }))
}
const input = (over = {}) => {
  const r = record()
  return { steps: r.journey.steps, lanes: r.journey.lanes, today: '2026-10-14', acceptanceStarted: true, ...over }
}

describe('allocate', () => {
  it('is proportional to the days when every share clears its minimum', () => {
    expect(allocate([10, 30], [10, 10], 400)).toEqual([100, 300])
  })

  it('lifts a short step to its minimum and shrinks the others proportionally', () => {
    const w = allocate([1, 50, 50], [124, 124, 124], 600)
    expect(w[0]).toBe(124)
    expect(w[1]).toBeCloseTo(238)
    expect(w[1]).toBeCloseTo(w[2])
  })

  it('gives an unknown day count the minimum, and shrinks minimums that cannot fit', () => {
    expect(allocate([null, 10], [124, 124], 600)[0]).toBe(124)
    expect(allocate([5, 5], [300, 300], 300)).toEqual([150, 150])
  })
})

describe('layoutRibbon', () => {
  it('forks into ICT and CRA lanes once the drive test is done, with Today at the end', () => {
    const layout = layoutRibbon(input(), 1100)
    expect(layout.fork).toBe(true)
    expect(layout.lanes.authorities.map((l) => [l.key, l.approved, l.total])).toEqual([['ict', 1, 3], ['cra', 1, 3]])
    expect(layout.today).toBeCloseTo(1100 - RIBBON.laneLabel)
    expect(layout.tail).toBeNull()
    expect(layout.milestones.map((m) => [m.key, m.big])).toEqual([
      ['on_air', true], ['health_check', false], ['assigned', false], ['dt_done', true],
    ])
  })

  it('keeps every finished segment at least its minimum width, the first wider', () => {
    const layout = layoutRibbon(input(), 1100)
    const xs = layout.milestones.map((m) => m.x)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(RIBBON.minFirst)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(RIBBON.minStep)
  })

  it('fills each lane by its approved share and says when it is complete', () => {
    const lanes = { ict: { approved: 3, total: 3, done_on: '2026-11-21' }, cra: { approved: 0, total: 3, done_on: null } }
    const layout = layoutRibbon(input({ lanes }), 1100)
    const [ict, cra] = layout.lanes.authorities
    expect(ict).toMatchObject({ all: true, doneOn: '21 Nov 2026', fillX: layout.lanes.b })
    expect(cra.fillX).toBe(layout.lanes.start)
  })

  it('draws the open step to Today and a dashed tail before the drive test is done', () => {
    const layout = layoutRibbon(input({ steps: steps(['done', 'done', 'in_progress', 'upcoming', 'upcoming', 'upcoming']), acceptanceStarted: false }), 1100)
    expect(layout.fork).toBe(false)
    expect(layout.open).not.toBeNull()
    expect(layout.today).toBe(layout.open.x1)
    expect(layout.durations.at(-1)).toMatchObject({ text: '7 d so far', open: true })
    expect(layout.tail.dots.map((d) => [d.key, d.date])).toEqual([
      ['dt_done', 'Not yet'], ['sent_to_ict', 'Not yet'], ['acceptance', 'ICT · CRA'],
    ])
  })

  it('shows "—" for a done step with no date and no days for its segment', () => {
    const s = steps(['done', 'done', 'in_progress', 'upcoming', 'upcoming', 'upcoming'])
    s[0] = { ...s[0], date: null }
    s[1] = { ...s[1], date: null, gap_days: null }
    const layout = layoutRibbon(input({ steps: s, acceptanceStarted: false }), 1100)
    expect(layout.milestones[0].date).toBe('—')
    expect(layout.durations.map((d) => d.text)).toEqual(['7 d so far'])
  })

  it('has no Today marker once acceptance is done', () => {
    const layout = layoutRibbon(input({ steps: steps(['done', 'done', 'done', 'done', 'done', 'done']) }), 1100)
    expect(layout.done).toBe(true)
    expect(layout.today).toBeNull()
  })
})

describe('the ribbon’s words', () => {
  it('lists every step and both lanes', () => {
    expect(ribbonSummary(input())).toBe(
      'On air 2 Sept 2026; Health check 9 Sept 2026; Assigned 16 Sept 2026; DT done 30 Sept 2026; '
      + 'Sent to ICT in progress, 14 days so far; Acceptance not yet; ICT 1 of 3 approved; CRA 1 of 3 approved',
    )
  })

  it('counts days forward only', () => {
    expect(daysBetween('2026-09-02', '2026-09-09')).toBe(7)
    expect(daysBetween('2026-09-09', '2026-09-02')).toBeNull()
    expect(daysBetween(null, '2026-09-02')).toBeNull()
  })
})
