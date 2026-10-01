// My Work's API, served from fixtures for the layout tests: a list long
// enough to scroll inside its card, every side status, re-filed rounds with
// carry-over, a filed letter shared by several villages, and Farsi names.
// Shapes follow app/schemas/my_work.py.

const NAMES = [
  'سرآسیاب', 'کهنوج بالا', 'حسین آباد', 'منوجان', 'رضی آباد', 'چاه ماهی', 'قلعه گنج', 'ده نو',
  'گلزار', 'باغ نو', 'دهنه', 'چشمه شور', 'سیاه کوه', 'زرند پایین', 'کوهبنان', 'باغین',
  'رابر', 'ماهان', 'جوپار', 'اختیارآباد', 'شهداد', 'گلباف', 'راین', 'دشتاب',
]
const PATTERN = [
  ['rejected', 'approved'], ['waiting', 'rejected'], ['returned', 'waiting'], ['waiting', 'returned'],
  ['waiting', 'waiting'], ['waiting', 'waiting'], ['approved', 'waiting'], ['waiting', 'filled'],
  ['filled', 'filled'], ['filled', 'waiting'],
]
const SITES = ['TB-4471', 'TB-5230', 'TB-5102', 'KR-1041', 'KR-0917', 'KR-1033']
const TECHS = [['3G', '4G'], ['4G'], ['2G', '4G'], ['2G', '3G', '4G']]

const editable = (s) => ['waiting', 'returned', 'rejected'].includes(s)

function side(status, view, villageIndex, authority) {
  const refiled = status === 'rejected' || status === 'returned'
  const round = status === 'waiting' ? null : 1
  const techs = TECHS[villageIndex % TECHS.length]
  return {
    status,
    round_no: round,
    next_round_no: editable(status) ? (round || 0) + 1 : null,
    editable: editable(status),
    reviewable: view === 'staff' && status === 'filled',
    to_file: status === 'rejected' ? techs.slice(-1) : status === 'approved' ? [] : techs,
    refiled,
    authority,
  }
}

export function myWorkRows(view) {
  return Array.from({ length: 48 }, (_, i) => {
    const [ict, cra] = PATTERN[i % PATTERN.length]
    const sides = { ICT: side(ict, view, i, 'ICT'), CRA: side(cra, view, i, 'CRA') }
    const refiling = Object.values(sides).filter((s) => s.refiled).map((s) => s.next_round_no)
    return {
      village_id: 1000 + i,
      village_code: `V-${10240 + i}`,
      village_name: NAMES[i % NAMES.length],
      site_id: 300 + (i % SITES.length),
      site_code: SITES[i % SITES.length],
      work_item_id: 500 + (i % SITES.length),
      province_name: 'کرمان',
      contractor_name: i % 2 ? 'Kerman DT' : 'Jiroft DT',
      requested_technologies: TECHS[i % TECHS.length],
      dt_date: '2026-05-08',
      dt_date_shamsi: '1405/02/18',
      days_waiting: [88, 61, 5, 7, 94, 42, 19, 12, 3, 3][i % 10],
      long_wait: [88, 61, 5, 7, 94, 42, 19, 12, 3, 3][i % 10] >= 60,
      refiling_round: refiling.length ? Math.max(...refiling) : null,
      sides,
    }
  })
}

const TABS = {
  contractor: ['your_move', 'new_letter', 'returned', 'not_filed', 'filled'],
  staff: ['filled', 'not_filed', 'new_letter', 'returned', 'all'],
}

function inTab(row, tab) {
  const s = [row.sides.ICT.status, row.sides.CRA.status]
  const exclusive = s.includes('rejected') ? 'new_letter'
    : s.includes('returned') ? 'returned'
      : s.includes('waiting') ? 'not_filed' : null
  if (tab === 'all') return true
  if (tab === 'filled') return s.includes('filled')
  if (tab === 'your_move') return exclusive !== null
  return exclusive === tab
}

export function myWorkList(url, view) {
  const params = new URL(url).searchParams
  const rows = myWorkRows(view)
  const tabs = TABS[view]
  const tab = params.get('tab') || tabs[0]
  const ids = params.get('ids')
  const listed = ids
    ? rows.filter((r) => ids.split(',').map(Number).includes(r.village_id))
    : rows.filter((r) => inTab(r, tab))
  const limit = Number(params.get('limit') ?? 100)
  return {
    scope: 'remaining',
    tab,
    view,
    read_only: false,
    tabs: tabs.map((key) => ({ key, count: rows.filter((r) => inTab(r, key)).length })),
    authority_totals: view === 'staff'
      ? { kind: 'to_check', ICT: rows.filter((r) => r.sides.ICT.status === 'filled').length, CRA: rows.filter((r) => r.sides.CRA.status === 'filled').length }
      : { kind: 'not_approved', ICT: rows.filter((r) => r.sides.ICT.status !== 'approved').length, CRA: rows.filter((r) => r.sides.CRA.status !== 'approved').length },
    total: listed.length,
    rows: listed.slice(0, limit),
    next_cursor: null,
    long_wait_days: 60,
  }
}

function history(row, authority) {
  const s = row.sides[authority]
  const techs = row.requested_technologies
  const letter = authority === 'ICT' ? '1405/ص/1920' : '1405/ر/0994'
  const base = {
    letter_number: letter, letter_date: '2026-07-02', letter_date_shamsi: '1405/04/11',
    source: 'Contractor', submitted_by_name: row.contractor_name, submitted_at: '2026-07-02T08:00:00Z',
    reviewed_by_name: 'Coordinator', reviewed_at: '2026-07-04T08:00:00Z', return_reason: null,
    scan: { evidence_id: 9, filename: 'letter.pdf' },
  }
  const approved = (round) => ({ ...base, submission_id: row.village_id * 10 + round, round_no: round, result: 'approved',
    claims: techs.map((tech) => ({ tech, result: 'approved', reason: null })) })
  if (s.status === 'waiting') return []
  if (s.status === 'approved') return [approved(1)]
  if (s.status === 'filled') {
    return [{ ...base, submission_id: row.village_id * 10 + 1, round_no: 1, result: 'pending', reviewed_by_name: null, reviewed_at: null,
      claims: techs.map((tech, i) => ({ tech, result: i === techs.length - 1 && row.village_id % 3 === 0 ? 'rejected' : 'approved',
        reason: i === techs.length - 1 && row.village_id % 3 === 0 ? 'interference near the main road' : null })) }]
  }
  if (s.status === 'returned') {
    return [{ ...base, submission_id: row.village_id * 10 + 1, round_no: 1, result: 'returned', return_reason: 'the scan is illegible',
      claims: techs.map((tech) => ({ tech, result: 'approved', reason: null })) }]
  }
  return [
    { ...base, submission_id: row.village_id * 10 + 2, round_no: 1, result: 'rejected',
      claims: techs.map((tech, i) => ({ tech, result: i === techs.length - 1 ? 'rejected' : 'approved',
        reason: i === techs.length - 1 ? 'weak signal at the village centre' : null })) },
  ]
}

export function myWorkVillage(url, view) {
  const id = Number(new URL(url).pathname.split('/').pop())
  const row = myWorkRows(view).find((r) => r.village_id === id) || myWorkRows(view)[0]
  const sides = Object.fromEntries(['ICT', 'CRA'].map((authority) => {
    const s = row.sides[authority]
    const rounds = history(row, authority)
    const last = rounds[0]
    return [authority, {
      ...s,
      carry_over: s.status === 'rejected' ? last.claims.map((c) => ({ tech: c.tech, result: c.result, round_no: 1 })) : [],
      last_reason: s.status === 'rejected'
        ? { round_no: 1, kind: 'rejected', techs: [last.claims[last.claims.length - 1].tech], reason: 'weak signal at the village centre' }
        : s.status === 'returned' ? { round_no: 1, kind: 'returned', techs: [], reason: 'the scan is illegible' } : null,
      same_letter: s.reviewable ? { letter_number: last.letter_number, count: 4 } : null,
      history: rounds,
    }]
  }))
  return {
    village_id: row.village_id,
    facts: {
      work_item_id: row.work_item_id, site_id: row.site_id, site_code: row.site_code,
      province_name: row.province_name, village_code: row.village_code, village_name: row.village_name,
      requested_technologies: row.requested_technologies, dt_date: row.dt_date, dt_date_shamsi: row.dt_date_shamsi,
    },
    contractor_name: row.contractor_name,
    sides,
  }
}

export function myWorkSuggestions(url, view) {
  const id = Number(new URL(url).pathname.split('/')[4])
  const rows = myWorkRows(view)
  const row = rows.find((r) => r.village_id === id) || rows[0]
  return {
    site_id: row.site_id,
    site_code: row.site_code,
    villages: rows.filter((r) => r.site_id === row.site_id && r.village_id !== id && r.sides.ICT.editable)
      .slice(0, 3)
      .map((r) => ({ village_id: r.village_id, village_code: r.village_code, village_name: r.village_name, status: r.sides.ICT.status })),
  }
}
