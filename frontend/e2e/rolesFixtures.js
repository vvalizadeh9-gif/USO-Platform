// Roles Performance payloads for the layout tests (UEP-09), at production
// size: 31 provinces, a dozen of each owner kind and long Persian names, so
// "the page never scrolls" is tested with more rows than the screen holds.

const PROVINCES = [
  'Alborz', 'Ardabil', 'East Azerbaijan', 'West Azerbaijan', 'Bushehr', 'Chaharmahal and Bakhtiari',
  'Fars', 'Gilan', 'Golestan', 'Hamadan', 'Hormozgan', 'Ilam', 'Isfahan', 'Kerman', 'Kermanshah',
  'North Khorasan', 'Khorasan Razavi', 'South Khorasan', 'Khuzestan', 'Kohgiluyeh and Boyer-Ahmad',
  'Kurdistan', 'Lorestan', 'Markazi', 'Mazandaran', 'Qazvin', 'Qom', 'Semnan',
  'Sistan and Baluchestan', 'Tehran', 'Yazd', 'Zanjan',
]
const PEOPLE = {
  contractor: ['پیشرو فن', 'ارتباط گستر', 'نوآوران شبکه', 'پارس تل', 'آریا موج', 'راه ارتباط',
    'فن آوران ارتباطات سپهر', 'مخابرات پایدار'],
  rm: ['Allahyar', 'Nobakht', 'Karimi', 'Pirayesh', 'Sadeghi', 'Rahimi', 'Moradi', 'Jafari',
    'Hosseini', 'Ebrahimi'],
  coordinator: ['Amir', 'Bahrami', 'Kazemi', 'Rostami'],
}

const month = (year, m, label) => ({ year, month: m, label_fa: label })

function owners(kind, total, seed) {
  const names = PEOPLE[kind]
  const weights = names.map((_, i) => ((i * 7 + seed) % 11 === 0 ? 0 : ((i * 13 + seed) % 9) + 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  const unattributed = Math.round(total * 0.04)
  let left = total - unattributed
  const entries = names.map((name, i) => {
    const now = i === names.length - 1 ? left : Math.min(left, Math.floor(((total - unattributed) * weights[i]) / sum))
    left -= now
    return { name, now, ref: 0, delta: now, lower_is_better: false, recorded: true, ref_recorded: true }
  })
  entries.sort((a, b) => b.now - a.now)
  entries.push({ name: 'Unattributed', now: unattributed, ref: 0, delta: unattributed,
    lower_is_better: false, recorded: true, ref_recorded: true })
  return entries
}

function row(key, label, unit, now, seed, over = {}) {
  return {
    key, label, unit, now, ref: null, delta: null, lower_is_better: false, recorded: true,
    ref_recorded: true, villages: null, owners: null,
    owners_by: {
      contractor: owners('contractor', now, seed),
      rm: owners('rm', now, seed + 1),
      coordinator: owners('coordinator', now, seed + 2),
    },
    ...over,
  }
}

export const rpMonth = {
  month: month(1405, 7, 'مهر ۱۴۰۵'),
  ref_month: month(1405, 6, 'شهریور ۱۴۰۵'),
  running: true,
  day: 21,
  days_in_month: 30,
  ref_day: 21,
  by: 'owners',
  recorded_from: month(1405, 7, 'مهر ۱۴۰۵'),
  current_month: month(1405, 7, 'مهر ۱۴۰۵'),
  first_year: 1404,
  undated_on_air: 0,
  last_cpm_import: '2026-10-10T08:00:00Z',
  sections: [
    { key: 'delivery', title: 'Project delivery', block: { value: 5, unit: 'sites' }, rows: [
      row('on_air', 'On air', 'sites', 128, 1, { villages: { now: 214 } }),
      row('dt_done', 'DT done', 'sites', 141, 2, { villages: { now: 236 } }),
    ] },
    { key: 'acceptance', title: 'Acceptance', block: { value: 10, unit: 'villages' }, rows: [
      row('ict_approved', 'ICT approved', 'villages', 1172, 3),
      row('cra_approved', 'CRA approved', 'villages', 1064, 4),
      row('fully_approved', 'Fully approved', 'villages', 1115, 5),
    ] },
    { key: 'full_config', title: 'Full config', block: { value: 5, unit: 'sites' }, rows: [
      row('full_config', 'Became full config', 'sites', 16, 6),
      row('fell_back', 'Fell back', 'sites', 5, 7, { lower_is_better: true }),
    ] },
    { key: 'problematic', title: 'Problematic', block: { value: 5, unit: 'sites' }, rows: [
      row('problem_resolved', 'Resolved', 'sites', 22, 8),
      row('problem_new', 'New problems', 'sites', 8, 9, { lower_is_better: true }),
    ] },
  ],
}

const measured = (villages, dt, i) => {
  const r = (base, spread) => Math.max(1, Math.min(99, base + (((i * 37) % spread) - spread / 2)))
  const onair = Math.round((villages * r(91, 14)) / 100)
  const full = Math.round((villages * r(51, 40)) / 100)
  const ict = Math.round((dt * r(72, 30)) / 100)
  const cra = Math.round((dt * r(70, 30)) / 100)
  const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null)
  return {
    onair: { count: onair, rate: pct(onair, villages) },
    dt: { count: dt, rate: pct(dt, villages) },
    full: { count: full, rate: pct(full, villages) },
    ict: { count: ict, rate: pct(ict, dt) },
    cra: { count: cra, rate: pct(cra, dt) },
  }
}

const NAMES = {
  province: PROVINCES,
  region: Array.from({ length: 9 }, (_, i) => `CRA region ${i + 1}`),
  contractor: PEOPLE.contractor,
  coordinator: PEOPLE.coordinator,
  rm: PEOPLE.rm,
}

export function rpArea(url) {
  const params = new URL(url).searchParams
  const breakdown = params.get('breakdown') || 'province'
  const lens = params.get('lens')
  const rows = NAMES[breakdown].map((name, i) => {
    const villages = 60 + ((i * 53) % 260)
    const dt = name.startsWith('Kohgiluyeh') ? 6 : Math.round(villages * 0.85)
    return { name, gaps_key: name, villages, measures: measured(villages, dt, i), low_sample: dt < 10 }
  })
  return {
    scope: lens
      ? { lens, key: params.get('key'), label: params.get('key'), chip: '6 provinces · 2 CRA regions',
        selectable: true, past: false, provinces: 6, cra_regions: 2 }
      : { lens: 'country', key: 'Whole country', label: 'Whole country', chip: '31 provinces',
        selectable: true, past: false, provinces: 31, cra_regions: 9 },
    as_of: '2026-10-10T08:00:00Z',
    read_only: false,
    totals: {
      villages: 5210,
      onair: { count: 4742, rate: 91 },
      dt: { count: 4428, rate: 85 },
      full: { count: 2657, rate: 51 },
      ict: { count: 3188, rate: 72 },
      cra: { count: 3100, rate: 70 },
    },
    national: { onair: 88.4, dt: 85, full: 51, ict: 72, cra: 70 },
    breakdown,
    breakdowns: ['province', 'region', 'contractor', 'coordinator', 'rm'].filter((b) => b !== lens),
    rows,
    low_sample_threshold: 10,
  }
}
