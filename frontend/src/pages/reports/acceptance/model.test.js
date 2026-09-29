// The Acceptance Dashboard's view model, rule by rule. Every number the page
// shows is the server's or one of these: a share, a pace, what is left.
import { describe, expect, it } from 'vitest'
import { MIN_LABEL_GAP, monotonePath, nudge, runs } from './chartGeometry'
import {
  arcFraction,
  axisTicks,
  buildKpis,
  chartSeries,
  chartSummary,
  daysLeft,
  dueToday,
  left,
  monthKey,
  monthView,
  pace,
  pct1,
  pctOf,
  perDay,
  tickAngle,
} from './model'

// ------------------------------------------------------------------ fixtures
const stream = (over = {}) => ({
  approved: 0, approved_cumulative: 0,
  internal_plan: null, internal_plan_cumulative: null,
  contractor_plan: null, contractor_plan_cumulative: null,
  ...over,
})
const month = (y, m, over = {}) => ({
  shamsi_year: y, shamsi_month: m, label: ['مرداد', 'شهریور', 'مهر'][m - 5], is_current: false,
  days_in_month: m <= 6 ? 31 : 30,
  village: stream(), ict: stream(), cra: stream(),
  ...over,
})
const progress = (over = {}) => ({
  today: { shamsi_year: 1405, shamsi_month: 7, day: 7, days_in_month: 30 },
  plans_available: true,
  internal_visible: true,
  months: [
    month(1405, 5, { village: stream({ approved: 300, approved_cumulative: 2500, internal_plan: 290, internal_plan_cumulative: 2490, contractor_plan: 320, contractor_plan_cumulative: 2520 }) }),
    month(1405, 6, { village: stream({ approved: 288, approved_cumulative: 2788, internal_plan: 320, internal_plan_cumulative: 2810, contractor_plan: 280, contractor_plan_cumulative: 2800 }) }),
    month(1405, 7, {
      is_current: true,
      village: stream({ approved: 92, approved_cumulative: 2880, internal_plan: 320, internal_plan_cumulative: 3130, contractor_plan: 300, contractor_plan_cumulative: 3100 }),
    }),
  ],
  ...over,
})

// --------------------------------------------------------------------- maths
describe('the month maths', () => {
  it('spreads the plan evenly over the days: due today, pace, what is left', () => {
    expect(dueToday(320, 7, 30)).toBe(75)
    expect(pace(92, 320, { isCurrent: true, d: 7, D: 30 })).toBe(17)
    expect(pace(60, 320, { isCurrent: true, d: 7, D: 30 })).toBe(-15)
    // A closed month is measured against the whole plan.
    expect(pace(328, 320, { isCurrent: false, d: 30, D: 30 })).toBe(8)
    expect(left(320, 92)).toBe(228)
    expect(left(320, 400)).toBe(0)
  })

  it('works out a daily rate, and treats the last day as one day', () => {
    expect(daysLeft(7, 30)).toBe(23)
    expect(perDay(228, 23)).toBe(10)
    expect(perDay(50, 0)).toBe(50)
    expect(perDay(0, 5)).toBe(0)
  })

  it('reports the true share past 100 while the arc stops at a full circle', () => {
    expect(pctOf(400, 320)).toBe(125)
    expect(arcFraction(400, 320)).toBe(1)
    expect(arcFraction(160, 320)).toBe(0.5)
    expect(tickAngle(15, 30)).toBe(180)
  })

  it('writes shares with one decimal under 100', () => {
    expect(pct1(2880, 4090)).toBe('70.4%')
    expect(pct1(50, 50)).toBe('100%')
    expect(pct1(1, 0)).toBeNull()
  })

  it('picks four round gridlines that clear the data', () => {
    expect(axisTicks(4500)).toEqual([1200, 2400, 3600, 4800])
    expect(axisTicks(360)).toEqual([100, 200, 300, 400])
    expect(axisTicks(0).length).toBe(4)
  })
})

// ------------------------------------------------------------------- panel
describe('monthView', () => {
  it('reads the running month against due-by-today', () => {
    const view = monthView(progress(), 'village', '1405-07')
    expect(view.status).toEqual({ text: 'Day 7 of 30', tone: 'accent' })
    expect(view.approved).toBe(92)
    expect(view.approvedToDate).toBe(2880)
    const [internal, contractor] = view.rings
    expect(internal).toMatchObject({ label: 'Internal PIP', plan: 320, pct: 29, tick: 84 })
    expect(internal.pace).toEqual({ text: '+17 vs due today', tone: 'success' })
    expect(contractor.pace).toEqual({ text: '+22 vs due today', tone: 'success' })
    expect(view.finish.title).toBe('To finish on plan (23 days left)')
    expect(view.finish.columns[0]).toMatchObject({ figure: '228 more', line: 'about 10 a day' })
  })

  it('says a met plan is met, not a negative number to go', () => {
    const p = progress()
    p.months[2].village.approved = 330
    const view = monthView(p, 'village', '1405-07')
    expect(view.finish.columns[0]).toMatchObject({ figure: 'Plan met', line: 'nothing left to do' })
    expect(view.rings[0].pct).toBe(103)
    expect(view.rings[0].arc).toBe(1)
  })

  it('gives a closed month its result, above, short of or exactly on plan', () => {
    const view = monthView(progress(), 'village', '1405-06')
    expect(view.status).toEqual({ text: 'Closed', tone: 'neutral' })
    expect(view.finish.title).toBe('Month result')
    expect(view.rings[0].tick).toBeNull()
    expect(view.rings[0].pace).toEqual({ text: '−32 vs plan', tone: 'danger' })
    expect(view.finish.columns).toEqual([
      { kind: 'internal', figure: '−32', line: 'short of plan' },
      { kind: 'contractor', figure: '+8', line: 'above plan' },
    ])

    const exact = progress()
    exact.months[1].village.approved = 320
    expect(monthView(exact, 'village', '1405-06').finish.columns[0]).toMatchObject({ figure: 'Met', line: 'exactly on plan' })
    expect(monthView(exact, 'village', '1405-06').rings[0].pace.text).toBe('On plan')
  })

  it('draws a month with no plan as "no plan set", with no pill and no number', () => {
    const view = monthView(progress(), 'ict', '1405-07')
    for (const ring of view.rings) {
      expect(ring.noPlan).toBe(true)
      expect(ring.pace).toBeUndefined()
    }
    expect(view.finish.columns.every((c) => c.figure === '—')).toBe(true)
  })

  it('shows one ring, the contractor’s own, when the Internal PIP is withheld', () => {
    const p = progress({ internal_visible: false })
    expect(monthView(p, 'village', '1405-07').rings.map((r) => r.label)).toEqual(['Contractor PIP'])
    expect(monthView(p, 'village', '1405-07', p.today, { isContractor: true }).rings.map((r) => r.label)).toEqual(['Your PIP'])
  })

  it('is null for a month outside the window', () => {
    expect(monthView(progress(), 'village', '1399-01')).toBeNull()
  })
})

// ------------------------------------------------------------------- chart
describe('chartSeries', () => {
  it('gives monthly bars an attainment pill against the Internal PIP', () => {
    const s = chartSeries(progress(), 'village', 'monthly')
    expect(s.points.map((p) => p.attainment)).toEqual([
      { text: '103%', tone: 'success' },
      { text: '90%', tone: 'danger' },
      { text: 'so far', tone: 'neutral' },
    ])
    expect(s.legend.map((l) => l.label)).toEqual(['Approved', 'Internal PIP', 'Contractor PIP', 'Month in progress'])
    expect(s.caption).toBeNull()
  })

  it('switches to running totals and its own legend in Cumulative', () => {
    const s = chartSeries(progress(), 'village', 'cumulative')
    expect(s.points.map((p) => p.value)).toEqual([2500, 2788, 2880])
    expect(s.legend.map((l) => l.label)).toEqual(['Approved to date', 'Internal PIP', 'Contractor PIP'])
    // The last closed month: 2,788 against 2,810.
    expect(s.callout).toMatchObject({ index: 1, text: '22 behind internal PIP' })
  })

  it('drops the plan legend and says why when a stream has no plan', () => {
    const s = chartSeries(progress(), 'ict', 'monthly')
    expect(s.legend.map((l) => l.key)).toEqual(['approved', 'current'])
    expect(s.caption).toBe('No ICT plan set yet. A PM sets it on Monthly Plan.')
    expect(s.points.every((p) => p.attainment == null)).toBe(true)

    const province = chartSeries(progress({ plans_available: false }), 'cra', 'monthly')
    expect(province.caption).toBe('Plans are set for the whole programme, not per province.')
  })

  it('calls the contractor’s plan "Your PIP" for a contractor', () => {
    const s = chartSeries(progress({ internal_visible: false }), 'village', 'monthly', { isContractor: true })
    expect(s.legend.map((l) => l.label)).not.toContain('Internal PIP')
  })

  it('summarises itself in words for assistive technology', () => {
    const s = chartSeries(progress(), 'ict', 'monthly')
    expect(chartSummary(s, 'ict', 'monthly')).toMatch(/^ICT approvals, last 3 months: 0 in مرداد/)
  })

  it('keys a month the way the address does', () => {
    expect(monthKey({ shamsi_year: 1405, shamsi_month: 7 })).toBe('1405-07')
  })
})

// --------------------------------------------------------------------- KPIs
const overview = {
  kpis: {
    total_onair_villages: 5000, total_dt_done_villages: 4000,
    total_ict_approval: 3000, total_ict_remained: 1000, total_ict_rejected: 400, total_ict_pending: 600,
    total_cra_approval: 2500, total_cra_remained: 1500, total_cra_rejected: 500, total_cra_pending: 1000,
  },
  analysis: { villages_both_approved: 2200 },
}

describe('buildKpis', () => {
  it('builds the Village band: on air, DT done, fully accepted, remaining', () => {
    const cards = buildKpis(overview, 'village')
    expect(cards.map((c) => [c.title, c.figure, c.context])).toEqual([
      ['Villages on air', 5000, null],
      ['Drive test done', 4000, '80.0% of on air'],
      ['Fully accepted', 2200, '55.0% of DT done'],
      ['Remaining', 1800, '45.0% of DT done'],
    ])
    expect(cards.some((c) => c.tiles)).toBe(false)
    expect(cards.map((c) => c.drill.metric)).toEqual(['onair', 'dt_done', 'approved', 'remaining'])
  })

  it.each(['ict', 'cra'])('splits the %s Remaining into rejected and waiting, which add up to it', (key) => {
    const cards = buildKpis(overview, key)
    const remaining = cards[3]
    const [rejected, waiting] = remaining.tiles
    expect(rejected.figure + waiting.figure).toBe(remaining.figure)
    expect(remaining.drill.authority).toBe(key.toUpperCase())
    expect(cards[2].bar.color).toBe(`var(--${key})`)
  })
})

// ----------------------------------------------------------------- geometry
describe('chart geometry', () => {
  it('pushes end labels at least 15px apart and keeps them in the plot', () => {
    const out = nudge([{ key: 'a', y: 100 }, { key: 'b', y: 104 }, { key: 'c', y: 108 }], 10, 300)
    expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(MIN_LABEL_GAP)
    expect(out[2].y - out[1].y).toBeGreaterThanOrEqual(MIN_LABEL_GAP)
    const low = nudge([{ key: 'a', y: 295 }, { key: 'b', y: 298 }], 10, 300)
    expect(low[1].y).toBeLessThanOrEqual(300)
  })

  it('splits a series where a value is missing', () => {
    expect(runs([{ x: 1 }, null, { x: 2 }, { x: 3 }]).map((r) => r.length)).toEqual([1, 2])
  })

  it('never overshoots between two equal values (monotone)', () => {
    const d = monotonePath([{ x: 0, y: 100 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 0 }])
    // The flat stretch between the 2nd and 3rd points stays flat.
    expect(d).toContain('C13.3,50.0 16.7,50.0 20.0,50.0')
  })
})
