// Acceptance cases (UEP-22): Filing's inbox, a case, its history, and the
// Baskets grid -- enough rows that the lists must scroll inside their panels.
const NAMES = ['صیادلر', 'موتور چنگيز', 'موردوییه', 'موتورحاجي بايان', 'سردشت سرجنگل', 'چاه سرخ', 'گنبدکنار', 'شهرک سرجنگل']

function row(i, state) {
  return {
    case_id: i, village_id: i, village_code: String(100000 + i), village_name: NAMES[i % NAMES.length],
    site_code: `SB0${400 + (i % 40)}`, state, category: state === 'rejected' ? 'CPG Power' : null,
    basket_key: state === 'rejected' ? 'team:CpgPower' : 'contractor:1',
    basket_owner: state === 'rejected' ? 'CPG Power' : 'Contractor A',
    sub: state === 'rejected' ? 'CPG Power · CPG Power' : `${100000 + i} · Contractor A`,
    days_in_basket: 90 - i, over_sla: 90 - i > 14, stale: i % 3 === 0, in_validation: i === 4,
  }
}

export function casesInbox(url) {
  const authority = new URL(url).searchParams.get('authority') || 'ICT'
  const waiting = Array.from({ length: 30 }, (_, i) => row(i + 1, 'waiting'))
  const rejected = Array.from({ length: 12 }, (_, i) => row(i + 40, 'rejected'))
  return {
    authority, tab: 'all', shown: 42, sla_days: 14, fresh_days: 7,
    can: { record_letters: true, comment: true, fix: true, change_basket: true, lands_directly: true, read_only: false },
    counts: { all: 42, waiting: 30, rejected: 12, no_comment: 14 },
    filters: {},
    groups: [
      { key: 'waiting', label: `Waiting for ${authority} · contractors`, count: 30, rows: waiting },
      { key: 'rejected', label: 'Rejected · team baskets', count: 12, rows: rejected },
    ],
  }
}

export function casesCase(url) {
  const id = Number(new URL(url).pathname.split('/').pop())
  const authority = new URL(url).searchParams.get('authority') || 'ICT'
  const other = authority === 'ICT' ? 'CRA' : 'ICT'
  return {
    village: { id, code: String(100000 + id), name: NAMES[id % NAMES.length], site_code: 'CE0265', work_item_id: 9, province: 'گیلان', tech: '2G', contractor: 'Contractor A' },
    sla_days: 14, fresh_days: 7,
    boxes: [
      { case_id: id, authority, state: 'rejected', label: 'Rejected', days_in_basket: 8, over_sla: false,
        sub: 'CPG Power · CPG Power basket', in_validation: false,
        comment: { stale: false, age_days: 2, text: 'Grid connection booked for 25 Nov.', author: 'CPG Power' } },
      { case_id: id + 1000, authority: other, state: 'waiting', label: `Waiting for ${other}`, days_in_basket: 57, over_sla: true,
        sub: 'Contractor basket · Contractor A', in_validation: false,
        comment: { stale: false, age_days: 3, text: 'Followed up with CRA Gilan.', author: 'Contractor A' } },
    ],
  }
}

export function casesHistory() {
  const step = (kind, title, date, delta, extra = {}) => ({ kind, title, date, status_step: kind !== 'comment', delta_days: delta, sub: null, note: null, actor: null, letter: null, ...extra })
  return {
    authority: 'ICT', dt_date: '2026-09-18', dt_legacy: false, days_since_dt: 63,
    steps: [
      step('dt', 'DT approved', '2026-09-18', null, { sub: 'by Farid' }),
      step('submitted', 'Submitted to ICT', '2026-09-24', 6, { sub: 'Batch #36', letter: { no: '4412', date_shamsi: '1405/07/02' } }),
      step('rejected', 'Rejected · CPG Power', '2026-11-12', 49, { sub: 'to CPG Power basket', note: 'ICT: site is on temporary power.', letter: { no: '9870', date_shamsi: '1405/08/21', evidence_id: 3 } }),
      step('comment', 'Comment · CPG Power', '2026-11-18', null, { note: 'Grid connection booked for 25 Nov.' }),
      { kind: 'now', title: 'Now · in CPG Power basket', date: '2026-11-20', status_step: true, delta_days: 8, over_sla: false, state: 'rejected' },
    ],
  }
}

export const casesCategories = [
  ['parked', 'Parked', 'PM'], ['nwg_rnd', 'NWG R&D', 'NwgPlanning'], ['contractor', 'Contractor', 'Contractor'],
  ['cpg_pso', 'CPG PSO', 'CpgPso'], ['cpg_pmo', 'CPG PMO', 'CpgRolloutPM'], ['cpg_power', 'CPG Power', 'CpgPower'], ['ms', 'MS', 'ManagedService'],
].map(([code, label, role], i) => ({ id: i + 1, code, label, basket_role: role }))

const cells = (a, b, c, d, nc) => ({ u3: a, m3_6: b, m6_12: c, o1y: d, no_comment: nc, total: a + b + c + d })

export function basketsGrid() {
  const rows = [
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((x, i) => ({ key: `contractor:${i + 1}`, label: `Contractor ${x}`, group: 'Contractors · waiting', kind: 'contractor', cells: cells(130 - i * 9, 180 - i * 12, 160 - i * 10, 100 - i * 7, 190 - i * 11) })),
    ...[['CpgPower', 'CPG Power'], ['NwgPlanning', 'NWG R&D'], ['CpgPso', 'CPG PSO'], ['CpgRolloutPM', 'CPG PMO'], ['ManagedService', 'MS']]
      .map(([role, label], i) => ({ key: `team:${role}`, label, group: 'Rejected · team baskets', kind: 'team', cells: cells(48 - i * 8, 40 - i * 7, 40 - i * 8, 24 - i * 5, 18 - i * 3) })),
    { key: 'rejected:contractor', label: 'Contractors (rejected)', group: 'Rejected · team baskets', kind: 'contractor', cells: cells(22, 9, 5, 0, 5) },
    { key: 'parked', label: 'PM', group: 'Parked', kind: 'team', cells: cells(5, 8, 20, 29, 0) },
  ]
  const sum = (k) => rows.reduce((s, r) => s + r.cells[k], 0)
  return {
    authority: 'both', open: sum('total'), no_comment: sum('no_comment'), sla_days: 14, fresh_days: 7,
    columns: [['u3', 'Under 3 months'], ['m3_6', '3–6 months'], ['m6_12', '6–12 months'], ['o1y', 'Over 1 year'], ['no_comment', 'No comment'], ['total', 'Total']]
      .map(([key, label]) => ({ key, label, total: sum(key) })),
    rows,
    default: { basket: 'team:CpgPower', column: 'm3_6' },
  }
}

export function basketsCell() {
  return {
    basket: 'team:CpgPower', label: 'CPG Power', column: 'm3_6', column_label: '3–6 months', count: 40, no_comment: 6,
    items: Array.from({ length: 40 }, (_, i) => ({
      case_id: i + 1, village_id: i + 1, authority: i % 2 ? 'CRA' : 'ICT', village_name: NAMES[i % NAMES.length],
      village_code: String(196000 + i), days_in_basket: 176 - i, stale: i % 7 === 0, comment_age: i % 7 === 0 ? 11 : 3,
      comment: i % 7 === 0 ? null : { text: 'Generator delivered, wiring next week.', author: 'CPG Power' },
    })),
  }
}
