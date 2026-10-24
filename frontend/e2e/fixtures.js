// API payloads for the layout e2e tests, shaped from app/schemas like the
// unit-test fixtures, but at production size: a thousand-row pool and a year
// of trend, because "the page never scrolls" only means something when there
// is more content than the screen can hold.

import { readFileSync } from 'node:fs'
import { currentShamsiPeriod } from '../src/lib/shamsi.js'

export const PM = {
  id: 1,
  username: 'pm',
  full_name: 'Programme Manager',
  role: { name: 'PM' },
  must_change_password: false,
}

export const CONTRACTOR = {
  id: 2,
  username: 'contractor',
  full_name: 'Kerman DT',
  role: { name: 'Contractor' },
  contractor_id: 1,
  must_change_password: false,
}

const PROVINCES = ['تهران', 'اصفهان', 'فارس', 'خراسان رضوی', 'کرمان', 'یزد', 'گیلان', 'مازندران']
const CONTRACTORS = ['پیشرو فن', 'ارتباط گستر', 'نوآوران شبکه', 'پارس تل', 'آریا موج', 'راه ارتباط']
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']

const kpi = (value, delta = null) => ({ value, delta, percent_of_onair: null })
const RUNNING = currentShamsiPeriod()

export const contractors = CONTRACTORS.map((name, i) => ({ id: i + 1, name }))

export const dtOverview = {
  kpis: {
    total_onair: kpi(3083, 64),
    total_dt_done: kpi(2171, 81),
    total_remaining: kpi(912, -17),
    total_ongoing: kpi(604, -9),
    total_problematic: kpi(143, 4),
    total_not_started: kpi(165, -12),
    current_month_dt_done: kpi(81),
  },
  ongoing_by_contractor: [],
  problematic_by_category: [],
  dt_done_by_contractor: [],
  dt_done_yearly: [],
  dt_done_monthly: [],
  progress_by_province: [],
  current_month_label: 'مهر 1405',
  generated_at: new Date(Date.now() - 4 * 60000).toISOString(),
  provinces: PROVINCES.map((name, i) => ({ id: i + 1, name })),
  province_id: null,
  ongoing_breakdown: {
    total: 604,
    by_stage: [],
    by_contractor: CONTRACTORS.map((name, i) => ({ name, value: 140 - i * 20 })),
    without_contractor: 14,
    by_province: PROVINCES.map((name, i) => ({ name, value: 120 - i * 12 })),
    by_age: [
      { name: 'Up to 1 week', value: 200, key: 'lte_1w' },
      { name: '1–2 weeks', value: 150, key: 'w1_2' },
      { name: '2–3 weeks', value: 100, key: 'w2_3' },
      { name: '3 weeks – 1 month', value: 80, key: 'w3_1m' },
      { name: '1–2 months', value: 50, key: 'm1_2' },
      { name: 'More than 2 months', value: 24, key: 'gt_2m' },
    ],
    without_assignment_date: 0,
  },
  problematic_breakdown: {
    total: 143,
    by_category: [
      { name: 'Power', value: 60, key: 'Power' },
      { name: 'Access', value: 50, key: 'Access' },
      { name: 'Transmission', value: 33, key: 'Transmission' },
    ],
    by_province: PROVINCES.map((name, i) => ({ name, value: 30 - i * 3 })),
    by_age: [
      { name: 'Up to 1 week', value: 40, key: 'lte_1w' },
      { name: '1–2 weeks', value: 30, key: 'w1_2' },
      { name: '2–3 weeks', value: 20, key: 'w2_3' },
      { name: '3 weeks – 1 month', value: 20, key: 'w3_1m' },
      { name: '1–2 months', value: 18, key: 'm1_2' },
      { name: 'More than 2 months', value: 15, key: 'gt_2m' },
    ],
    without_problem_date: 0,
  },
  province_breakdown: PROVINCES.map((name, i) => ({
    name, onair: 500 - i * 40, done: 350 - i * 30, remaining: 150 - i * 10,
    ongoing: 100 - i * 8, problematic: 25 - i * 2, not_started: 25, done_percent: 70 - i,
  })),
  contractor_scorecard: CONTRACTORS.map((name, i) => ({
    contractor_id: i + 1, name, assigned: 400 - i * 40, done: 300 - i * 35, ongoing: 100 - i * 5,
    problematic: 20, not_started: 0, done_percent: 75 - i * 4,
  })),
}

export const dtPlan = {
  shamsi_year: RUNNING.year,
  shamsi_month: RUNNING.month,
  month_label: `${MONTHS[RUNNING.month - 1]} ${RUNNING.year}`,
  pip: 320, assigned: 290, actual: 150, achievement_percent: 46.9,
  committed_contractors: 5, uncommitted_contractors: 1, programme_achievement_percent: null,
  rows: [],
}

export const dtTrend = {
  months: [],
  latest_flows: {
    shamsi_year: RUNNING.year, shamsi_month: RUNNING.month, label: MONTHS[RUNNING.month - 1], is_open: true,
    opening_remaining: 929, closing_remaining: 912, new_onair: 64, dt_completed: 81,
    newly_problematic: 12, problematic_resolved: 8,
  },
  province_id: null,
}

export const dtFlow = {
  opening: { on_air: 1600, dt_done: 900 },
  months: Array.from({ length: 19 }, (_, i) => ({
    year: 1404 + Math.floor(i / 12),
    month: (i % 12) + 1,
    on_aired: 70 + ((i * 13) % 40),
    dt_done: 60 + ((i * 17) % 50),
    is_open: i === 18,
  })),
  not_placed: { on_air: 0, dt_done: 0 },
  province_id: null,
}

const trendPoints = Array.from({ length: 12 }, (_, i) => ({
  shamsi_year: RUNNING.year - (i < 12 - RUNNING.month ? 1 : 0),
  shamsi_month: ((RUNNING.month - 12 + i + 12) % 12) + 1,
  shamsi_month_name: MONTHS[(RUNNING.month - 12 + i + 12) % 12],
  pip: 320, delivered: i % 2 ? 331 : 290, hit: Boolean(i % 2), in_progress: i === 11,
}))

const ovRow = (i, over = {}) => ({
  contractor_id: i + 1, name: CONTRACTORS[i], assignment: 262 - i * 20, pip: 60 - i * 5, delivered: 20 - i * 2,
  diff: -40, status: 'approved', pip_above_assignment: false, hit_last_6: { hit: 4, of: 6 },
  plan_id: 10 + i, plan_status: 'Approved', committed_count: 60, version: 1, in_force_count: 60,
  in_force_version: 1, revision_from: null, revision_to: null, revision_reason: null,
  revision_comment: null, return_comment: null, is_late: false,
  expected_by_today: 12 - i, pace_diff: 13 - i * 4,
  ...over,
})

const streamOut = (stream) => ({
  stream,
  kpis: {
    assignment: stream === 'DT' ? 1290 : null, internal_pip: stream === 'DT' ? 345 : null,
    contractor_pip: 320, gap_vs_internal: stream === 'DT' ? -25 : null, delivered: 86,
    achievement_percent: 26.7, expected_by_today: 58, pace_diff: 28,
  },
  all_contractors: {
    assignment: stream === 'DT' ? 1290 : null, pip: 320, delivered: 86, diff: -234,
    plans_approved: 6, plans_total: 7, hit_last_6: { hit: 3, of: 6 },
  },
  rows: [
    ...CONTRACTORS.map((_, i) => ovRow(i)),
    ovRow(5, { contractor_id: 7, name: 'مخابرات نوین', pip: null, delivered: 0, status: 'not_submitted', plan_id: null }),
  ],
  trend: trendPoints,
})

const pipOverviewMonth = {
  period: 'month', shamsi_year: RUNNING.year, shamsi_month: RUNNING.month,
  shamsi_month_name: MONTHS[RUNNING.month - 1],
  months: [{ shamsi_year: RUNNING.year, shamsi_month: RUNNING.month, shamsi_month_name: MONTHS[RUNNING.month - 1] }],
  running_year: RUNNING.year, running_month: RUNNING.month, day_of_month: 6, days_in_month: 30,
  revision_window_open: true, revisions_close_on: '',
  dt: streamOut('DT'),
  acceptance: streamOut('ACCEPTANCE'),
  ict: streamOut('ICT'),
  cra: streamOut('CRA'),
  needs_attention: [],
}

// UEP-08: the year view's months[] per stream, for the History tab.
const yearMonths = (year) =>
  MONTHS.map((name, i) => {
    const m = i + 1
    const future = year > RUNNING.year || (year === RUNNING.year && m > RUNNING.month)
    const base = { shamsi_year: year, shamsi_month: m, shamsi_month_name: name }
    if (future) return { ...base, plan: null, delivered: null, internal: null, is_running: false, is_future: true, contractors: [] }
    const people = CONTRACTORS.map((c, k) => ({ id: k + 1, name: c, plan: 50 + k * 5, delivered: 40 + ((m * 7 + k * 11) % 30) }))
    return {
      ...base,
      plan: people.reduce((a, p) => a + p.plan, 0),
      delivered: people.reduce((a, p) => a + p.delivered, 0),
      internal: 360,
      is_running: year === RUNNING.year && m === RUNNING.month,
      is_future: false,
      contractors: people,
    }
  })

/** GET /pip/overview: the month view, or the year view with months[]. */
export const pipOverview = (url) => {
  const params = new URL(url).searchParams
  if (params.get('period') !== 'year') return pipOverviewMonth
  const year = Number(params.get('year'))
  const withMonths = (stream) => ({ ...stream, months: yearMonths(year) })
  return {
    ...pipOverviewMonth,
    period: 'year',
    dt: withMonths(pipOverviewMonth.dt),
    acceptance: withMonths(pipOverviewMonth.acceptance),
    ict: withMonths(pipOverviewMonth.ict),
    cra: withMonths(pipOverviewMonth.cra),
  }
}

// GET /pip/queue, UEP-08: every contractor (plus one more, so the Plans list
// holds seven rows and scrolls inside itself) has DT and Acceptance waiting
// for the planning month; one has a revision on the running month.
const QUEUE_PEOPLE = [...CONTRACTORS, 'مخابرات نوین']
export const pipQueue = (url) => {
  const params = new URL(url).searchParams
  const stream = params.get('stream')
  const running = Number(params.get('month')) === RUNNING.month && Number(params.get('year')) === RUNNING.year
  const row = (k, over) => ({
    contractor_id: k + 1, contractor_name: QUEUE_PEOPLE[k], plan_id: 100 + k + (stream === 'DT' ? 0 : 50),
    status: 'Submitted', committed_count: 40 + k * 3, previous_month_committed: 38 + k * 2, version: 1,
    submitted_at: '2026-10-05T08:00:00Z', is_late: false, return_comment: null, in_force_count: null,
    revision_reason: null, revision_comment: null, assignment: 60 - k * 6, pip: 50, delivered: 20, ...over,
  })
  let rows = []
  if (running) {
    rows = stream === 'DT'
      ? [row(0, { plan_id: 900, status: 'RevisionRequested', committed_count: 44, in_force_count: 52, revision_reason: 'SITES_BLOCKED' })]
      : []
  } else if (stream === 'DT' || stream === 'ACCEPTANCE') {
    rows = QUEUE_PEOPLE.map((_, k) => row(k))
  }
  return { label: '', stream, rows, current_month: {} }
}

// GET /pip/internal-target (UEP-18): the target and last month's.
export const pipInternalTarget = (url) => {
  const stream = new URL(url).searchParams.get('stream')
  return { stream, current: { stream, target_count: 150 }, previous: { stream, target_count: 145 }, history: [] }
}

// GET /pip/scorecard (UEP-18): the DT assignment, left empty here.
export const pipScorecard = () => ({ months: [], summable: [], balances: [], is_contractor: false })

// ----- Lifecycle Gaps ------------------------------------------------------
//
// The national totals are the design's; the owners are placeholders and the
// split between them is made up. Every lens's rows add up to every gap, as
// the server guarantees.

const GAP_TOTALS = { eligible: 4433, ict_approved: 3042, cra_approved: 3858 }
const GAP_FIGURES = {
  pending_ict: { count: 1391, base: 4433 },
  pending_cra: { count: 575, base: 4433 },
  ict_remained: { count: 991, base: 3858 },
  cra_remained: { count: 175, base: 3042 },
  ict_missing_in_mojri: { count: 3042, base: 3042, in_tracker: 0, needs_look: 0 },
  cra_missing_in_mojri: { count: 3858, base: 3858, in_tracker: 0, needs_look: 0 },
}

const GAP_OWNERS = {
  coordinator: ['V. Hashemi', 'R. Karimi', 'S. Moradi', 'A. Rahimi', 'M. Jafari', 'N. Ahmadi', 'H. Kazemi',
    'F. Sadeghi', 'P. Rostami', 'Z. Hosseini', 'K. Bagheri', 'L. Ebrahimi', 'T. Sharifi'],
  contractor: CONTRACTORS,
  province: ['Tehran', 'Isfahan', 'Fars', 'Khorasan Razavi', 'Kerman', 'Yazd', 'Gilan', 'Mazandaran',
    'Khuzestan', 'East Azerbaijan', 'West Azerbaijan', 'Kermanshah', 'Hormozgan', 'Sistan & Baluchestan',
    'Golestan', 'Lorestan', 'Hamadan', 'Markazi', 'Qazvin', 'Zanjan', 'Ardabil', 'Kurdistan', 'Ilam',
    'Bushehr', 'Semnan', 'Qom', 'Alborz', 'Chaharmahal & Bakhtiari', 'Kohgiluyeh & Boyer-Ahmad',
    'North Khorasan', 'South Khorasan'],
  region: ['North', 'North East', 'North West', 'Central', 'Azar', 'South', 'South East', 'West', 'East'],
  rm: ['Allahyar', 'Nobakht', 'Pirayesh', 'Rouhi', 'Fazl Talab'],
}
const MANAGERS = GAP_OWNERS.rm

/** `total` split over `n` owners, largest first, summing exactly. */
function split(total, n) {
  const weights = Array.from({ length: n }, (_, i) => n - i + (i % 3))
  const whole = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => Math.floor((total * w) / whole))
  parts[0] += total - parts.reduce((a, b) => a + b, 0)
  return parts
}

function gapRows(lens) {
  const names = GAP_OWNERS[lens]
  const rows = {}
  for (const [key, gap] of Object.entries(GAP_FIGURES)) {
    const counts = split(gap.count, names.length)
    const bases = split(gap.base, names.length)
    rows[key] = names
      .map((name, i) => ({
        name,
        count: counts[i],
        base: bases[i],
        attribution: 'owned',
        ...(lens === 'coordinator' ? { managers: [MANAGERS[i % MANAGERS.length]] } : {}),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
  return rows
}

export function gapsOverview(url) {
  const lens = new URL(url).searchParams.get('lens') || 'coordinator'
  return {
    last_cpm_import: '2026-09-20T09:30:00Z',
    last_mojri_import: null,
    scoped: false,
    lens,
    key: null,
    lenses: [],
    totals: GAP_TOTALS,
    gaps: GAP_FIGURES,
    rows: gapRows(lens),
    data_quality: { villages_without_province: 0, unmapped_provinces: [] },
  }
}

export const kpiLenses = { selectable: true, options: {} }

// ----- Lifecycle Gaps: the coverage map ------------------------------------
//
// Every province in the map asset, with a made-up spread of approval rates.
// The detail panels' owner rows are split from each shape's own figures, so
// they add up the way the server's folds do.

const IRAN = JSON.parse(readFileSync(new URL('../src/pages/reports/iranMap.json', import.meta.url), 'utf8'))

const stretchFig = (stopped, reached) => ({
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  low_sample: reached < 10,
})

const fig = (sites, villages) => ({ sites, villages })

function panelFigures(base, ictRate, craRate) {
  const ictApproved = Math.round(base * ictRate)
  const craApproved = Math.round(base * craRate)
  const sites = (n) => Math.round(n / 1.6)
  return {
    delivery: {
      assigned: fig(sites(base * 1.2), Math.round(base * 1.2)),
      on_air: fig(sites(base * 1.1), Math.round(base * 1.1)),
      dt: fig(sites(ictApproved) + sites(base - ictApproved), base),
    },
    ict: { approved: fig(sites(ictApproved), ictApproved), pending: fig(sites(base - ictApproved), base - ictApproved) },
    cra: { approved: fig(sites(craApproved), craApproved), pending: fig(sites(ictApproved) + sites(base - ictApproved) - sites(craApproved), base - craApproved) },
  }
}

const withSites = (f) => ({ ...f, sites: { approved: Math.round((f.reached - f.stopped) / 1.6), reached: Math.round(f.reached / 1.6) } })

const mapProvinces = Object.entries(IRAN.provinces).map(([key, shape], i) => {
  const base = 60 + ((i * 37) % 340)
  const ictRate = 0.2 + ((i * 13) % 75) / 100
  const craRate = Math.min(ictRate, 0.15 + ((i * 29) % 70) / 100)
  const figures = panelFigures(base, ictRate, craRate)
  const reached = base + 40
  const ictStopped = Math.round(reached * (1 - ictRate))
  const craReached = reached - ictStopped
  return {
    key,
    name: shape.en,
    attribution: 'owned',
    region: shape.region,
    managers: [GAP_OWNERS.rm[i % GAP_OWNERS.rm.length]],
    villages: reached + 20,
    ict: withSites(stretchFig(ictStopped, reached)),
    cra: withSites(stretchFig(Math.round(craReached * (1 - craRate / Math.max(ictRate, 0.01))), craReached)),
    detail: figures,
  }
})

const sumFig = (rows, stretch, counter) => rows.reduce((s, r) => s + r[stretch][counter], 0)

function sumDetail(members) {
  const out = {}
  for (const [group, figures] of Object.entries(members[0].detail)) {
    out[group] = {}
    for (const name of Object.keys(figures)) {
      out[group][name] = fig(
        members.reduce((s, m) => s + m.detail[group][name].sites, 0),
        members.reduce((s, m) => s + m.detail[group][name].villages, 0)
      )
    }
  }
  return out
}

const mapRegions = Object.keys(IRAN.regions).map((name) => {
  const members = mapProvinces.filter((p) => p.region === name)
  return {
    name,
    attribution: 'owned',
    provinces: members.map((m) => m.key),
    managers: [...new Set(members.flatMap((m) => m.managers))].sort(),
    villages: members.reduce((s, m) => s + m.villages, 0),
    ict: withSites(stretchFig(sumFig(members, 'ict', 'stopped'), sumFig(members, 'ict', 'reached'))),
    cra: withSites(stretchFig(sumFig(members, 'cra', 'stopped'), sumFig(members, 'cra', 'reached'))),
    detail: sumDetail(members),
  }
})

export const gapsMap = {
  scoped: false,
  lens_label: null,
  key: null,
  last_cpm_import: '2026-09-20T09:30:00Z',
  low_sample_threshold: 10,
  provinces: mapProvinces,
  regions: mapRegions,
  total: {
    villages: mapProvinces.reduce((s, p) => s + p.villages, 0),
    ict: withSites(stretchFig(sumFig(mapProvinces, 'ict', 'stopped'), sumFig(mapProvinces, 'ict', 'reached'))),
    cra: withSites(stretchFig(sumFig(mapProvinces, 'cra', 'stopped'), sumFig(mapProvinces, 'cra', 'reached'))),
    detail: sumDetail(mapProvinces),
  },
}

// ----- Lifecycle Gaps: the export ------------------------------------------
//
// How many villages the mocked `/gaps/villages.xlsx` lists for a request:
// read from the same fixtures the page draws, the way the server reads the
// same cells the overview folds.

const STRETCH_OF = {
  pending_ict: ['ict', 'pending'], pending_cra: ['cra', 'pending'],
  ict_approved: ['ict', 'approved'], cra_approved: ['cra', 'approved'],
}

export function exportCount(url) {
  const q = new URL(url).searchParams
  const gap = q.get('gap')
  const lens = q.get('lens')
  const key = q.get('key')
  const scope = q.get('scope')
  if (scope) {
    const [kind, value] = scope.split(/:(.*)/s)
    const shape =
      kind === 'province' ? mapProvinces.find((p) => p.key === value) : mapRegions.find((r) => r.name === value)
    const [stretch, counter] = STRETCH_OF[gap]
    return shape.detail[stretch][counter].villages
  }
  if (lens) return gapRows(lens)[gap].find((row) => row.name === key).count
  return GAP_FIGURES[gap]?.count ?? GAP_TOTALS[gap]
}

// ------------------------------------------------------ Acceptance Dashboard
// Shaped from app/schemas: AcceptanceOverview and AcceptanceProgress. Totals
// run to four digits, the widest the chart's labels and the panel's figures
// have to hold.
export const accOverview = {
  kpis: {
    total_onair_villages: 5210, total_onair_permanent: 4100, total_onair_temporary: 1110,
    total_dt_done_villages: 4437,
    total_ict_approval: 3840, total_ict_remained: 597, total_ict_rejected: 404, total_ict_pending: 193,
    total_cra_approval: 3044, total_cra_remained: 1393, total_cra_rejected: 435, total_cra_pending: 958,
  },
  analysis: {
    sites_ict_full: 0, sites_cra_full: 0, sites_ict_and_cra_full: 0, sites_ict_not_cra: 0, sites_cra_not_ict: 0,
    villages_ict_not_cra: 0, villages_cra_not_ict: 0, villages_both_approved: 2884,
    villages_accepted: 2884, villages_needs_attention: 0, villages_in_review: 0, villages_not_filed: 0,
    villages_rejected: 0, villages_remained: 0,
  },
  provinces: [],
}

/** The running Shamsi year, Farvardin to Esfand (`GET /acceptance/progress
 * ?year=`): closed months, the running one, then months to come with their
 * plans only and `approved: null`. Plans start in Tir. */
function progressMonths() {
  const { year, month: running } = RUNNING
  const stream = (approvedPer, internal, contractor, opening) => {
    let run = opening
    let internalRun = opening
    let contractorRun = opening
    return approvedPer.map((approved, i) => {
      const future = i + 1 > running
      const planned = i >= 3
      if (!future) run += approved
      if (!planned) { internalRun = run; contractorRun = run }
      return {
        approved: future ? null : approved,
        approved_cumulative: future ? null : run,
        internal_plan: planned ? internal : null,
        internal_plan_cumulative: planned ? (internalRun += internal) : null,
        contractor_plan: planned ? contractor : null,
        contractor_plan_cumulative: planned ? (contractorRun += contractor) : null,
      }
    })
  }
  const village = stream([180, 210, 250, 290, 305, 330, 92, 340, 310, 360, 318, 300], 320, 300, 0)
  const ict = stream([260, 300, 340, 400, 420, 380, 118, 410, 390, 420, 372, 400], 400, 380, 0)
  const cra = stream([200, 230, 260, 300, 320, 280, 44, 300, 290, 310, 260, 300], 300, 280, 0)
  return MONTHS.map((label, i) => ({
    shamsi_year: year, shamsi_month: i + 1, label,
    is_current: i + 1 === running, is_future: i + 1 > running, days_in_month: i < 6 ? 31 : 30,
    village: village[i], ict: ict[i], cra: cra[i],
  }))
}

export const accProgress = {
  today: { shamsi_year: RUNNING.year, shamsi_month: RUNNING.month, day: 7, days_in_month: RUNNING.month <= 6 ? 31 : 30 },
  plans_available: true,
  internal_visible: true,
  years: [RUNNING.year, RUNNING.year - 1],
  months: progressMonths(),
}

// UEP Home for the PM: a full Drive test card (with a queue past the
// 30-item dot limit), acceptance all on time, and the month's plan.
const homeTicket = (queue_key, short_label, label, url, { on_time = 0, due_soon = 0, late = 0, age = 5, owners = [], more = 0, unit = 'sites' } = {}) => ({
  queue_key, short_label, label, url, unit,
  count: on_time + due_soon + late, on_time, due_soon, late,
  oldest_started_at: new Date(Date.now() - age * 86400000).toISOString(),
  earliest_due_at: null, date_kind: 'since', owners, owners_more: more, owners_total: owners.length + more,
})

const homeGroups = [
  {
    key: 'drive_test', label: 'Drive test', scope_label: null,
    tickets: [
      homeTicket('hc_assign', 'HC assignment', 'Assign sites', '/health-check?tab=pool&state=ready', { late: 224, age: 16 }),
      homeTicket('dt_review', 'DT review', 'Review DT results', '/drive-test?tab=review', { on_time: 6, late: 3, age: 21, owners: ['پیشرو فن', 'آرین ارتباط'], more: 7 }),
      homeTicket('hc_review', 'HC review', 'Review HC results', '/health-check?tab=review', { on_time: 4, late: 2, age: 18 }),
      homeTicket('dt_assign', 'DT assignment', 'Assign drive tests', '/drive-test?tab=assignment', { on_time: 18, due_soon: 3, late: 1, age: 16 }),
    ],
  },
  {
    key: 'acceptance', label: 'Acceptance', scope_label: 'All project',
    tickets: [
      homeTicket('ict_pending', 'Pending ICT', 'Open ICT acceptance', '/my-work?authority=ICT', { on_time: 30, late: 12, age: 19, unit: 'villages', owners: ['پیشرو فن'], more: 4 }),
      homeTicket('cra_pending', 'Pending CRA', 'Open CRA acceptance', '/my-work?authority=CRA', { on_time: 41, due_soon: 2, late: 7, age: 17, unit: 'villages', owners: ['آرین ارتباط'], more: 5 }),
    ],
  },
  {
    key: 'plans', label: 'Plans', scope_label: null,
    tickets: [homeTicket('plans_approve', 'Plan approvals', 'Approve plans', '/monthly-plan', { due_soon: 2, age: 12 })],
  },
]

// The headline and the badges are summed from the tickets, as the server
// does: a hand-typed total here once read "268 in 6 queues" over cards that
// held 266.
const homeTickets = homeGroups.flatMap((g) => g.tickets)
const homeSum = (key) => homeTickets.reduce((n, t) => n + t[key], 0)
const homeBadges = {}
for (const t of homeTickets.filter((x) => x.count)) {
  const path = t.url.split('?')[0]
  homeBadges[path] = homeBadges[path] || { count: 0, parts: [] }
  homeBadges[path].count += t.count
  homeBadges[path].parts.push({ label: t.short_label, count: t.count })
}
const homeDays = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10))

export const homeSummaryPm = {
  role: 'PM',
  scope_label: 'All project',
  generated_at: '2026-10-09T08:54:00Z',
  shamsi_date: '1405-07-17',
  due_soon_days: 3,
  sla_uniform_days: 14,
  sla_days: { hc_review: 14, dt_assign: 14, dt_review: 14 },
  totals: {
    pending: homeSum('count'), queues: homeTickets.length, overdue: homeSum('late'), due_soon: homeSum('due_soon'),
    pending_week_delta: 4, overdue_week_delta: -2, due_soon_week_delta: -1, done_today: 6, done_yesterday: 4,
  },
  trends: {
    days: homeDays,
    pending: [null, null, 340, 344, 351, 349, 355, 356, 352, 358, 361, 360, 364, homeSum('count')],
    overdue: [null, null, 236, 238, 240, 245, 247, 246, 248, 249, 250, 251, 253, homeSum('late')],
    due_soon: [null, null, 12, 11, 9, 10, 8, 9, 7, 8, 7, 8, 8, homeSum('due_soon')],
    done: [3, 5, 2, 4, 6, 3, 5, 7, 4, 3, 5, 6, 4, 6],
  },
  groups: homeGroups,
  plan: { stream: 'DT', shamsi_year: 1405, shamsi_month: 7, month_name: 'Mehr', pip: 64, delivered: 41, days_left: 13 },
  app_badges: homeBadges,
}

// GET /search for the header search (UEP-12): whatever the term, one site
// with a Persian province and a village, so rows, meta and <bdi> all render.
export const searchResults = {
  sites: [{ id: 7, site_code: 'W4-1021', province: 'کرمان', stage: 'Acceptance' }],
  villages: [{ work_item_id: 7, village_name: 'دهنو', village_code: 'V10232', site_code: 'W4-1021' }],
  provinces: [],
  contractors: [],
  people: [],
}
