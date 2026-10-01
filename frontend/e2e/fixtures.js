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

export const pipOverview = {
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

export const pipQueue = { label: '', stream: 'DT', rows: [], current_month: {} }

const HC_STATES = ['New', 'New', 'New', 'In health check', 'Awaiting triage', 'Fix in progress', 'Health check passed']
export const hcBasket = Array.from({ length: 1012 }, (_, i) => {
  const state = HC_STATES[i % HC_STATES.length]
  return {
    work_item_id: i + 1,
    site_code: `SITE-${String(10000 + i)}`,
    province: PROVINCES[i % PROVINCES.length],
    site_type: i % 3 ? 'Macro' : 'Micro',
    requested_technologies: i % 2 ? ['2G', '4G'] : ['3G'],
    dt_status: i % 5 ? null : 'Ongoing',
    hc_state: state,
    assignable: state !== 'In health check',
    round_no: 1,
    returning_reason: null,
    days_waiting: (i * 7) % 90,
  }
})

export const hcInProgress = Array.from({ length: 40 }, (_, i) => ({
  assignment_id: i + 1,
  code: `HC-${1400 + i}`,
  contractor_id: (i % CONTRACTORS.length) + 1,
  contractor_name: CONTRACTORS[i % CONTRACTORS.length],
  assigned_at: new Date(Date.now() - (i + 2) * 86400000).toISOString(),
  days_outstanding: 40 - i,
  sites_total: 12,
  sites_submitted: 4,
  sites_pending: 8,
  pending_sites: Array.from({ length: 8 }, (_, j) => `SITE-${20000 + i * 10 + j}`),
}))

export const hcCounts = {
  pool: 1012, pool_assignable: 868, in_progress: 320, hc_in_progress_late: 26,
  hc_review: 12, remediation: 9, reroutes: 2, dt_assignment: 38, dt_in_progress: 96, dt_review: 7,
}

export const dtAssignment = Array.from({ length: 38 }, (_, i) => ({
  work_item_id: 5000 + i,
  site_code: `SITE-${30000 + i}`,
  province: PROVINCES[i % PROVINCES.length],
  requested_technologies: ['2G', '4G'],
  rounds_taken: i % 4 === 0 ? 2 : 1,
  hc_contractor: CONTRACTORS[i % CONTRACTORS.length],
  days_waiting: 20 - (i % 20),
  returned_reason: null,
}))

export const dtInProgress = Array.from({ length: 96 }, (_, i) => ({
  work_item_id: 6000 + i,
  site_code: `SITE-${40000 + i}`,
  site_type: 'Macro',
  province: PROVINCES[i % PROVINCES.length],
  requested_technologies: ['4G'],
  contractor_id: (i % CONTRACTORS.length) + 1,
  contractor_name: CONTRACTORS[i % CONTRACTORS.length],
  assigned_at: new Date(Date.now() - i * 86400000).toISOString(),
  days_since_assigned: i % 30,
  status: i % 9 ? 'with_contractor' : 'sent_back',
  sent_back_comment: null,
  sent_back_at: null,
}))

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

const PANEL_OWNERS = {
  coordinator: GAP_OWNERS.coordinator.slice(0, 3),
  contractor: CONTRACTORS.slice(0, 4),
  rm: GAP_OWNERS.rm.slice(0, 2),
}

function panelFigures(base, ictRate, craRate) {
  const ictApproved = Math.round(base * ictRate)
  const craApproved = Math.round(base * craRate)
  return {
    ict: { approved: ictApproved, base, pending: base - ictApproved, remained: Math.round((base - ictApproved) * 0.4) },
    cra: { approved: craApproved, base, pending: base - craApproved, remained: Math.round((base - craApproved) * 0.3) },
  }
}

/** Split each counter of `figures` over `names`, summing exactly. */
function ownerRows(figures, names, extra = () => ({})) {
  const pieces = {}
  for (const stretch of ['ict', 'cra']) {
    for (const counter of ['approved', 'base', 'pending', 'remained']) {
      pieces[`${stretch}.${counter}`] = split(figures[stretch][counter], names.length)
    }
  }
  return names.map((name, i) => {
    const row = { name, attribution: 'owned', ...extra(name, i), ict: {}, cra: {} }
    for (const [path, parts] of Object.entries(pieces)) {
      const [stretch, counter] = path.split('.')
      row[stretch][counter] = parts[i]
    }
    return row
  })
}

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
    ict: stretchFig(ictStopped, reached),
    cra: stretchFig(Math.round(craReached * (1 - craRate / Math.max(ictRate, 0.01))), craReached),
    detail: {
      ...figures,
      owners: Object.fromEntries(
        Object.entries(PANEL_OWNERS).map(([lens, names]) => [lens, ownerRows(figures, names)])
      ),
    },
  }
})

const sumFig = (rows, stretch, counter) => rows.reduce((s, r) => s + r[stretch][counter], 0)

const mapRegions = Object.keys(IRAN.regions).map((name) => {
  const members = mapProvinces.filter((p) => p.region === name)
  const figures = {}
  for (const stretch of ['ict', 'cra']) {
    figures[stretch] = {}
    for (const counter of ['approved', 'base', 'pending', 'remained']) {
      figures[stretch][counter] = members.reduce((s, m) => s + m.detail[stretch][counter], 0)
    }
  }
  const provinceRows = members.map((m) => ({
    name: m.name,
    key: m.key,
    attribution: 'owned',
    ict: m.detail.ict,
    cra: m.detail.cra,
  }))
  return {
    name,
    attribution: 'owned',
    provinces: members.map((m) => m.key),
    managers: [...new Set(members.flatMap((m) => m.managers))].sort(),
    villages: members.reduce((s, m) => s + m.villages, 0),
    ict: stretchFig(members.reduce((s, m) => s + m.ict.stopped, 0), members.reduce((s, m) => s + m.ict.reached, 0)),
    cra: stretchFig(members.reduce((s, m) => s + m.cra.stopped, 0), members.reduce((s, m) => s + m.cra.reached, 0)),
    detail: {
      ...figures,
      owners: {
        province: provinceRows,
        ...Object.fromEntries(
          Object.entries(PANEL_OWNERS).map(([lens, names]) => [lens, ownerRows(figures, names)])
        ),
      },
    },
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
    ict: stretchFig(sumFig(mapProvinces, 'ict', 'stopped'), sumFig(mapProvinces, 'ict', 'reached')),
    cra: stretchFig(sumFig(mapProvinces, 'cra', 'stopped'), sumFig(mapProvinces, 'cra', 'reached')),
  },
}

// ----- Lifecycle Gaps: the export ------------------------------------------
//
// How many villages the mocked `/gaps/villages.xlsx` lists for a request:
// read from the same fixtures the page draws, the way the server reads the
// same cells the overview folds.

const STRETCH_OF = {
  pending_ict: ['ict', 'pending'], pending_cra: ['cra', 'pending'],
  ict_remained: ['ict', 'remained'], cra_remained: ['cra', 'remained'],
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
    if (!lens) return shape.detail[stretch][counter]
    return shape.detail.owners[lens].find((row) => row.name === key)[stretch][counter]
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

function progressMonths() {
  const out = []
  let { year, month } = RUNNING
  for (let i = 0; i < 12; i += 1) {
    out.unshift({ year, month })
    month -= 1
    if (month === 0) { month = 12; year -= 1 }
  }
  const stream = (approvedPer, internal, contractor, opening) => {
    let run = opening
    let internalRun = opening
    let contractorRun = opening
    return out.map((p, i) => {
      const approved = approvedPer[i]
      const row = {
        approved,
        approved_cumulative: (run += approved),
        internal_plan: i >= 3 ? internal : null,
        internal_plan_cumulative: i >= 3 ? (internalRun += internal) : null,
        contractor_plan: i >= 3 ? contractor : null,
        contractor_plan_cumulative: i >= 3 ? (contractorRun += contractor) : null,
      }
      if (i < 3) { internalRun = run; contractorRun = run }
      return row
    })
  }
  const village = stream([180, 210, 250, 290, 305, 330, 280, 340, 310, 360, 318, 92], 320, 300, 0)
  const ict = stream([260, 300, 340, 400, 420, 380, 360, 410, 390, 420, 372, 118], 400, 380, 0)
  const cra = stream([200, 230, 260, 300, 320, 280, 250, 300, 290, 310, 260, 44], 300, 280, 0)
  return out.map((p, i) => ({
    shamsi_year: p.year, shamsi_month: p.month, label: MONTHS[p.month - 1],
    is_current: i === 11, days_in_month: p.month <= 6 ? 31 : 30,
    village: village[i], ict: ict[i], cra: cra[i],
  }))
}

export const accProgress = {
  today: { shamsi_year: RUNNING.year, shamsi_month: RUNNING.month, day: 7, days_in_month: RUNNING.month <= 6 ? 31 : 30 },
  plans_available: true,
  internal_visible: true,
  months: progressMonths(),
}
