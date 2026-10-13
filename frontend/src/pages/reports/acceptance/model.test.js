// The Acceptance Dashboard's view model, rule by rule. Every number the page
// shows is the server's or one of these: a share, a pace, what is left.
import { describe, expect, it } from 'vitest'
import {
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
  readout,
  selectableKeys,
  selectedMonth,
  yearTrack,
} from './model'

// ------------------------------------------------------------------ fixtures
const NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
const stream = (over = {}) => ({
  approved: 0, approved_cumulative: 0,
  internal_plan: null, internal_plan_cumulative: null,
  contractor_plan: null, contractor_plan_cumulative: null,
  ...over,
})
const future = (over = {}) => stream({ approved: null, approved_cumulative: null, ...over })

/** 1405, today 7 Mehr: Farvardin-Shahrivar closed, Mehr running, the rest
 * to come. `rows` overrides the village stream per month number. */
function progress({ rows = {}, internalVisible = true, plansAvailable = true, year = 1405, current = 7 } = {}) {
  return {
    today: { shamsi_year: 1405, shamsi_month: 7, day: 7, days_in_month: 30 },
    plans_available: plansAvailable,
    internal_visible: internalVisible,
    years: [1405, 1403],
    months: NAMES.map((label, i) => {
      const m = i + 1
      const isFuture = year > 1405 || (year === 1405 && m > current)
      const base = isFuture ? future() : stream()
      return {
        shamsi_year: year,
        shamsi_month: m,
        label,
        is_current: year === 1405 && m === current,
        is_future: isFuture,
        days_in_month: m <= 6 ? 31 : 30,
        village: { ...base, ...(rows[m] ?? {}) },
        ict: base,
        cra: base,
      }
    }),
  }
}

const plans = (internal, internalCum, contractor, contractorCum) => ({
  internal_plan: internal, internal_plan_cumulative: internalCum,
  contractor_plan: contractor, contractor_plan_cumulative: contractorCum,
})

// --------------------------------------------------------------- the maths
describe('the month maths', () => {
  it('spreads the plan evenly over the days: due today, pace, what is left', () => {
    expect(dueToday(300, 7, 30)).toBe(70)
    expect(pace(50, 300, { isCurrent: true, d: 7, D: 30 })).toBe(-20)
    expect(pace(310, 300, { isCurrent: false, d: 31, D: 31 })).toBe(10)
    expect(left(300, 92)).toBe(208)
    expect(left(300, 320)).toBe(0)
    expect(daysLeft(7, 30)).toBe(23)
  })

  it('works out a daily rate, and treats the last day as one day', () => {
    expect(perDay(208, 23)).toBe(10)
    expect(perDay(5, 0)).toBe(5)
  })

  it('reports the true share, past 100 too', () => {
    expect(pctOf(330, 300)).toBe(110)
  })

  it('writes shares with one decimal under 100', () => {
    expect(pct1(2884, 4437)).toBe('65.0%')
    expect(pct1(5, 5)).toBe('100%')
    expect(pct1(1, 0)).toBeNull()
  })

  it('picks four round gridlines that clear the data', () => {
    expect(axisTicks(330)).toEqual([100, 200, 300, 400])
    expect(axisTicks(0)).toEqual([0.25, 0.5, 0.75, 1])
  })
})

// --------------------------------------------------------------- months
describe('which month opens', () => {
  it('offers every month that has started, never one to come', () => {
    expect(selectableKeys(progress())).toEqual(
      ['01', '02', '03', '04', '05', '06', '07'].map((m) => `1405-${m}`),
    )
  })

  it('opens ?month= when it can, else the running month', () => {
    expect(selectedMonth(progress(), '1405-05')).toBe('1405-05')
    expect(selectedMonth(progress(), '1405-09')).toBe('1405-07')
    expect(selectedMonth(progress(), 'nonsense')).toBe('1405-07')
  })

  it('opens Esfand of a past year, and nothing of a year still to come', () => {
    expect(selectedMonth(progress({ year: 1403 }), null)).toBe('1403-12')
    expect(selectedMonth(progress({ year: 1406 }), null)).toBeNull()
  })

  it('keys a month the way the address does', () => {
    expect(monthKey({ shamsi_year: 1405, shamsi_month: 7 })).toBe('1405-07')
  })
})

// ------------------------------------------------------------- PIP card
describe('monthView (the PIP card)', () => {
  it('says how far behind pace the running month is, and what is left per day', () => {
    const p = progress({ rows: { 7: stream({ approved: 50, approved_cumulative: 2880, ...plans(300, 3130, 200, 3100) }) } })
    const view = monthView(p, 'village', '1405-07')
    expect(view.status).toBe('Day 7 of 30')
    expect(view.isCurrent).toBe(true)
    const [internal, contractor] = view.plans
    expect(internal).toMatchObject({ label: 'Internal PIP', act: 50, plan: 300, pct: 17 })
    expect(internal.today).toBeCloseTo((100 * 7) / 30)
    // due today 70, approved 50: 20 behind; 250 to go over 23 days.
    expect(internal.line).toEqual([
      { text: '20 behind pace', tone: 'danger', strong: true },
      { text: '250 to go, about 11 a day' },
    ])
    // due today 47, approved 50: ahead, so no "behind" clause.
    expect(contractor.line).toEqual([{ text: '150 to go, about 7 a day' }])
  })

  it('says a met plan is met', () => {
    const p = progress({ rows: { 7: stream({ approved: 320, ...plans(300, null, null, null) }) } })
    expect(monthView(p, 'village', '1405-07').plans[0].line).toEqual([{ text: 'Plan met' }])
  })

  it('gives a closed month its result: short of, above, or exactly on plan', () => {
    const p = progress({
      rows: {
        4: stream({ approved: 280, ...plans(300, null, 260, null) }),
        5: stream({ approved: 300, ...plans(300, null, null, null) }),
      },
    })
    const july = monthView(p, 'village', '1405-04')
    expect(july.status).toBe('Closed')
    expect(july.plans[0].line).toEqual([{ text: '−20 short of plan', tone: 'danger' }])
    expect(july.plans[1].line).toEqual([{ text: '+20 above plan' }])
    expect(july.plans[0].today).toBeNull()
    expect(monthView(p, 'village', '1405-05').plans[0].line).toEqual([{ text: 'Exactly on plan' }])
  })

  it('draws a plan that does not exist as "No plan set", with no bar', () => {
    const row = monthView(progress(), 'village', '1405-05').plans[0]
    expect(row).toMatchObject({ noPlan: true, plan: null, line: [{ text: 'No plan set' }] })
    expect(row.bar).toBeUndefined()
  })

  it('reads the total to date against the Internal PIP to date', () => {
    const p = progress({ rows: { 6: stream({ approved: 10, approved_cumulative: 2788, ...plans(320, 2810, 280, 2800) }) } })
    expect(monthView(p, 'village', '1405-06').toDate).toEqual({
      approved: 2788,
      plan: 2810,
      planLabel: 'Internal PIP to date',
      gap: { text: '22 behind', tone: 'danger' },
    })
  })

  it('shows a contractor only "Your PIP", and measures to date against it', () => {
    const p = progress({
      internalVisible: false,
      rows: { 6: stream({ approved: 10, approved_cumulative: 2830, ...plans(null, null, 280, 2800) }) },
    })
    const view = monthView(p, 'village', '1405-06', { isContractor: true })
    expect(view.plans.map((r) => r.label)).toEqual(['Your PIP'])
    expect(view.toDate).toMatchObject({ planLabel: 'Your PIP to date', gap: { text: '30 ahead' } })
  })

  it('is null for a month to come or one not in the year', () => {
    expect(monthView(progress(), 'village', '1405-09')).toBeNull()
    expect(monthView(progress(), 'village', '1399-01')).toBeNull()
  })
})

// ---------------------------------------------------------------- chart
describe('chartSeries (the year chart)', () => {
  const p = progress({
    rows: {
      5: stream({ approved: 300, ...plans(290, null, 320, null) }),
      6: stream({ approved: 288, ...plans(320, null, 280, null) }),
      7: stream({ approved: 92, ...plans(320, null, 300, null) }),
      9: future(plans(330, null, null, null)),
    },
  })
  const series = chartSeries(p, 'village')

  it('always draws twelve months, Farvardin to Esfand', () => {
    expect(series.points.map((x) => x.label)).toEqual(NAMES)
  })

  it('writes "{p}%" of plan under a closed month, danger under 100', () => {
    expect(series.points[4].under).toEqual({ text: '103%', tone: undefined })
    expect(series.points[5].under).toEqual({ text: '90%', tone: 'danger' })
    expect(series.points[0].under).toBeNull()
  })

  it('writes "so far" under the running month and "plan" under one to come', () => {
    expect(series.points[6].under).toEqual({ text: 'so far' })
    expect(series.points[8]).toMatchObject({ isFuture: true, approved: null, internal: 330, under: { text: 'plan' } })
  })

  it('puts Today inside the running month', () => {
    expect(series.today).toEqual({ index: 6, at: 7 / 30 })
  })

  it('keys only what it draws', () => {
    expect(series.legend.map((l) => l.label)).toEqual([
      'Approved', 'Internal PIP', 'Contractor PIP', 'In progress', 'Planned',
    ])
    const past = chartSeries(progress({ year: 1403 }), 'village')
    expect(past.legend.map((l) => l.key)).toEqual(['approved'])
    expect(past.caption).toBe('No village plan set for this year.')
  })

  it('says why there is no plan when the page is narrowed to a province', () => {
    expect(chartSeries(progress({ plansAvailable: false }), 'ict').caption).toBe(
      'Plans are set for the whole programme, not per province.',
    )
  })

  it('reads one month in the readout: figures for a month, plans only for one to come', () => {
    expect(readout(series, 5)).toEqual({
      name: 'شهریور ۱۴۰۵',
      note: null,
      figures: [
        { key: 'approved', label: 'Approved', value: 288 },
        { key: 'internal', label: 'Internal PIP', value: 320 },
        { key: 'contractor', label: 'Contractor PIP', value: 280 },
      ],
      pct: { text: '90% of Internal PIP', tone: 'danger' },
    })
    expect(readout(series, 8)).toMatchObject({ note: 'Upcoming', figures: [{ key: 'internal', value: 330 }], pct: null })
  })

  it('summarises itself in words for assistive technology', () => {
    expect(chartSummary(series, 'village', '۱۴۰۵')).toMatch(/^Fully accepted against plan, ۱۴۰۵\. /)
    expect(chartSummary(series, 'village', '۱۴۰۵')).toContain('آذر: planned 330')
  })
})

describe('yearTrack (the year plan row)', () => {
  it('reads the year so far against what was due by today', () => {
    const p = progress({
      rows: {
        6: stream({ approved: 288, ...plans(320, null, null, null) }),
        7: stream({ approved: 92, ...plans(300, null, null, null) }),
        9: future(plans(330, null, null, null)),
      },
    })
    // due: 320 (Shahrivar) + 70 (Mehr pro rata); plan: 320 + 300 + 330.
    expect(yearTrack(p, 'village')).toEqual({
      approved: 380,
      plan: 950,
      fill: 40,
      due: { value: 390, at: (100 * 390) / 950 },
      pct: { text: '97% of due', tone: 'danger' },
    })
  })

  it('reads a past year against its whole plan', () => {
    const p = progress({ year: 1403 })
    p.months[0].village = stream({ approved: 12, ...plans(10, null, null, null) })
    expect(yearTrack(p, 'village')).toMatchObject({ due: null, pct: { text: '120% of plan', tone: undefined } })
  })

  it('is hidden when the year has no plan', () => {
    expect(yearTrack(progress(), 'village')).toBeNull()
  })
})

// ------------------------------------------------------------------ KPIs
describe('buildKpis (the strip)', () => {
  const overview = {
    kpis: {
      total_onair_villages: 5210, total_dt_done_villages: 4437,
      total_ict_approval: 3840, total_ict_remained: 597, total_ict_rejected: 404, total_ict_pending: 193,
    },
    analysis: { villages_both_approved: 2884, villages_rejected: 1100, villages_remained: 453 },
  }

  it('builds four tiles, each with one line', () => {
    const tiles = buildKpis(overview, 'village', { thisMonth: 92 })
    expect(tiles.map((t) => t.title)).toEqual(['Villages on air', 'Drive test done', 'Fully accepted', 'Remaining'])
    expect(tiles[0].line).toEqual([{ text: '773 awaiting drive test' }])
    expect(tiles[0].visual).toBeNull()
    expect(tiles[1].line).toEqual([{ text: '85.2% of on air' }])
    expect(tiles[2].line).toEqual([{ text: '+92 this month · 65.0% of DT done' }])
  })

  it('leaves out "+n this month" while it is not known', () => {
    expect(buildKpis(overview, 'village').at(2).line).toEqual([{ text: '65.0% of DT done' }])
  })

  it('splits Village Remaining into rejected and waiting, each opening its own list', () => {
    const remaining = buildKpis(overview, 'village').at(3)
    expect(remaining.figure).toBe(1553)
    expect(remaining.line.map((p) => [p.figure, p.drill.metric, p.drill.authority])).toEqual([
      [1100, 'rejected', undefined],
      [453, 'remained', undefined],
    ])
  })

  it('reads ICT Remaining from the ICT figures, with the authority on every drill', () => {
    const tiles = buildKpis(overview, 'ict')
    expect(tiles[2]).toMatchObject({ title: 'ICT approved', figure: 3840 })
    expect(tiles[3].line.map((p) => [p.figure, p.tone, p.drill.authority])).toEqual([
      [404, 'danger', 'ICT'],
      [193, 'pending', 'ICT'],
    ])
    expect(tiles[3].visual.stack.map((s) => s.color)).toEqual([
      'var(--uep-status-danger-dot)',
      'var(--uep-status-pending-dot)',
    ])
  })
})
