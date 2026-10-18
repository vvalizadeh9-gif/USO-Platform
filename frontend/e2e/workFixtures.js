// API payloads for the Health check, Drive test and All sites work pages
// (UEP-06), at a size that overflows their cards. Apart from fixtures.js
// because that file reads the map from disk at import, which the unit tests'
// jsdom cannot; src/pages/pipeline/workPagesAxe.test.jsx imports this one.

const PROVINCES = ['تهران', 'اصفهان', 'فارس', 'خراسان رضوی', 'کرمان', 'یزد', 'گیلان', 'مازندران']
const CONTRACTORS = ['پیشرو فن', 'ارتباط گستر', 'نوآوران شبکه', 'پارس تل', 'آریا موج', 'راه ارتباط']

const step = (count, late, sla = 14) => ({ count, late, oldest_days: 40, sla_days: sla })
export const pipelineSummary = {
  hc1: step(728, 26), hc2: step(320, 26), hc3: step(12, 0), dt4: step(38, 6),
  dt5: step(86, 4), dt6: step(7, 0), done: step(1200, 0, null), remediation: step(9, 2, null),
  reroutes: step(2, 0), sent_back: step(10, 1),
}

export const contractorLoad = CONTRACTORS.map((name, i) => ({
  contractor_id: i + 1,
  name,
  open: (i * 7) % 30,
  late: i % 3,
  avg_submit_days: i % 2 ? null : 4 + i,
  provinces: [{ province: PROVINCES[i % PROVINCES.length], share: 0.6 }],
}))

export const hcResults = Array.from({ length: 40 }, (_, i) => ({
  task_id: 900 + i,
  work_item_id: 7000 + i,
  site_code: `SITE-${50000 + i}`,
  site_type: 'Macro',
  overall_result: i % 3 ? 'Ready' : 'NotReady',
  problem_category: null,
  problem_categories: [],
  round_no: 1 + (i % 2),
  requested_technologies: ['2G', '4G'],
  reviewed: false,
  assignment_code: `HC-${1500 + i}`,
  contractor_name: CONTRACTORS[i % CONTRACTORS.length],
  technologies: [
    { technology: '2G', result: 'Normal', reason_category: null, comment: null },
    { technology: '4G', result: i % 3 ? 'Normal' : 'NotNormal', reason_category: null, comment: i % 3 ? null : 'آنتن آسیب دیده است' },
  ],
  completed_at: new Date(Date.now() - i * 86400000).toISOString(),
  days_waiting: i,
}))

export const dtReview = Array.from({ length: 30 }, (_, i) => ({
  drive_test_id: 800 + i,
  work_item_id: 8000 + i,
  site_code: `SITE-${60000 + i}`,
  site_type: 'Macro',
  province: PROVINCES[i % PROVINCES.length],
  contractor_name: CONTRACTORS[i % CONTRACTORS.length],
  execution_date: '2026-10-01',
  submitted_at: new Date(Date.now() - i * 86400000).toISOString(),
  days_waiting: i,
  report_link: null,
  evidence: i % 4 ? [{ id: i, original_filename: `report-${i}.pdf`, content_type: 'application/pdf', size_bytes: 120000, uploaded_at: null }] : [],
}))

export const remediations = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  work_item_id: 9000 + i,
  site_code: `SITE-${70000 + i}`,
  province: PROVINCES[i % PROVINCES.length],
  category: ['Temp Power', 'CPG Project', 'Managed Service'][i % 3],
  owner_role: 'CpgPower',
  round_no: 1,
  technologies: ['4G'],
  issue: 'برق سایت قطع است',
  days_open: 30 - i,
  days_late: i < 5 ? 5 - i : 0,
  due_at: null,
  reroute_pending: i === 2,
}))

export const reroutes = [1, 2].map((i) => ({
  id: i, work_item_id: 9500 + i, site_code: `SITE-${75000 + i}`, province: PROVINCES[i],
  from_category: 'Temp Power', to_category: 'CPG Project', reason: 'این مورد مربوط به پروژه است',
  proposed_by: 'CPG Owner', proposed_at: null, days_open: 3,
}))

const STAGES = ['HC In Progress', 'HC Review', 'Ready for Assignment', 'Assigned', 'Returned by Contractor', 'DT Submitted', 'DT Done', 'Problematic']
export const workItems = (url) => {
  const stage = new URL(url).searchParams.get('stage')
  return Array.from({ length: 100 }, (_, i) => ({
    id: 10000 + i,
    site_code: `SITE-${80000 + i}`,
    site_type: i % 3 ? 'Macro' : 'Micro',
    province: PROVINCES[i % PROVINCES.length],
    requested_technology: '2G/4G',
    current_stage: stage || STAGES[i % STAGES.length],
    project_name: null,
    launch_date_shamsi: '1405/06/12',
    village: null,
    village_count: 0,
    contractor_name: i % 2 ? CONTRACTORS[i % CONTRACTORS.length] : null,
    assignment_date: null, assignment_user: null, returned_date: null, dt_submission_date: null,
    dt_approval_date: null, dt_approval_user: null, aging_days: null, assigned_aging_days: 12,
  }))
}
export const workItemCounts = {
  All: 2468, 'HC In Progress': 320, 'HC Review': 12, 'Ready for Assignment': 38, Assigned: 86,
  'Returned by Contractor': 4, 'DT Submitted': 7, 'DT Done': 1200, Problematic: 801,
}

export const hcBasket = Array.from({ length: 240 }, (_, i) => ({
  work_item_id: i + 1,
  site_code: `SITE-${10000 + i}`,
  province: PROVINCES[i % PROVINCES.length],
  site_type: 'Macro',
  requested_technologies: i % 2 ? ['2G', '4G'] : ['3G'],
  dt_status: i % 5 ? null : 'Ongoing',
  hc_state: i % 9 ? 'New' : 'Ready for re-check',
  assignable: true,
  round_no: i % 9 ? 1 : 2,
  returning_reason: null,
  days_waiting: (i * 7) % 90,
  waiting_since: null,
  village: i % 4 ? `روستای ${i}` : null,
  village_count: i % 4 ? 1 + (i % 3) : 0,
}))

export const hcInProgress = Array.from({ length: 6 }, (_, i) => ({
  assignment_id: i + 1, code: `HC-${1400 + i}`, contractor_id: i + 1, contractor_name: CONTRACTORS[i],
  assigned_at: null, days_outstanding: 40 - i, sites_total: 12, sites_submitted: 4, sites_pending: 8,
  pending_sites: [],
  pending: Array.from({ length: 8 }, (_, j) => ({
    task_id: i * 10 + j + 1, work_item_id: 20000 + i * 10 + j, site_code: `SITE-${20000 + i * 10 + j}`,
    province: PROVINCES[(i + j) % PROVINCES.length], assigned_at: null, days_waiting: 40 - i * 5,
  })),
}))

export const dtAssignment = Array.from({ length: 38 }, (_, i) => ({
  work_item_id: 5000 + i, site_code: `SITE-${30000 + i}`, site_type: 'Macro', province: PROVINCES[i % PROVINCES.length],
  requested_technologies: ['2G', '4G'], rounds_taken: i % 4 === 0 ? 2 : 1, hc_contractor: CONTRACTORS[i % CONTRACTORS.length],
  ready_since: null, days_waiting: 20 - (i % 20), returned_reason: i % 7 ? null : 'راه بسته است', returned_at: null,
  village: `ده ${i}`, village_count: 1,
}))

export const dtInProgress = Array.from({ length: 96 }, (_, i) => ({
  work_item_id: 6000 + i, site_code: `SITE-${40000 + i}`, site_type: 'Macro', province: PROVINCES[i % PROVINCES.length],
  requested_technologies: ['4G'], contractor_id: (i % CONTRACTORS.length) + 1, contractor_name: CONTRACTORS[i % CONTRACTORS.length],
  assigned_at: null, days_since_assigned: i % 30, status: i % 9 ? 'with_contractor' : 'sent_back',
  sent_back_comment: i % 9 ? null : 'گزارش ناقص است', sent_back_at: null,
}))

/** UEP-14: Checks batches and Tests sites. */
export const hcBatches = {
  counts: { open: 6, to_decide: 3, overdue: 1, completed: 4 },
  rows: Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    code: `HC-16OCT-${String(i + 1).padStart(2, '0')}`,
    contractor_id: (i % 3) + 1,
    contractor: CONTRACTORS[i % CONTRACTORS.length],
    assigned_at: '2026-10-16T08:00:00Z',
    assigned_by: 'Sara PM',
    due_at: '2026-10-18T08:00:00Z',
    completed_at: null,
    sla_days: 2,
    round: i === 2 ? 2 : 1,
    sites: 9,
    counts: { ready: 5, not_ready: 1, pending: 3, to_decide: i % 2 ? 6 : 0 },
    status: i % 2 ? 'to_decide' : 'open',
  })),
}

export const dtTests = {
  counts: { review: 8, with: 20, reviewed: 12 },
  rows: Array.from({ length: 30 }, (_, i) => ({
    work_item_id: 900 + i,
    assignment_id: 500 + i,
    drive_test_id: 700 + i,
    site_code: `DT${String(i).padStart(3, '0')}`,
    province: 'تهران',
    contractor_id: 1,
    contractor: CONTRACTORS[0],
    batch: `DT-${500 + i}`,
    round: i === 0 ? 2 : 1,
    aging_days: 3 + i * 2,
    sla_days: 14,
    late: 3 + i * 2 > 14,
    assigned_at: '2026-10-01T08:00:00Z',
    assigned_by: 'Sara PM',
    submitted_at: '2026-10-10T08:00:00Z',
    evidence_count: i % 3,
    outcome: null,
    technologies: ['2G', '4G'],
    villages: [{ id: 10 + i, code: `V${i}`, name: 'روستا', is_new: false }],
  })),
}
