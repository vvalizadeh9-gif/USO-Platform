// API payloads for the layout e2e tests, shaped from app/schemas like the
// unit-test fixtures, but at production size: a thousand-row pool and a year
// of trend, because "the page never scrolls" only means something when there
// is more content than the screen can hold.

import { currentShamsiPeriod } from '../src/lib/shamsi.js'

export const PM = {
  id: 1,
  username: 'pm',
  full_name: 'Programme Manager',
  role: { name: 'PM' },
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
