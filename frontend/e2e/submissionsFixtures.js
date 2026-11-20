// Acceptance › Submissions (UEP-21) payloads, shaped from api/submissions.py,
// at production size: forty sites in Ready, forty batches, so "the page never
// scrolls" means something. Names, numbers and dates are mock data.

const PROVINCES = ['فارس', 'هرمزگان', 'کرمان', 'سیستان و بلوچستان', 'تهران']
const REGIONS = ['South', 'South East', 'South East', 'South East', 'North']
const REASONS = ['new_dt', 'missed', 'became_target', 'resend']

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)

export function summary({ scoped = false, canAct = true, isPM = true } = {}) {
  return {
    ready: { villages: 64, sites: 41, reasons: { all: 64, new_dt: 30, missed: 20, became_target: 12, resend: 2 } },
    batches: { sent: 40, waiting: 130 },
    follow_up: { late: 9, oldest_days: 41, raised: 3, not_raised: 6 },
    mojri: { in_mojri: 312, waiting: 130, late: 9, as_of: iso(5), age_days: 5, stale: false, follow_up_days: 30 },
    in_draft: 0,
    cycle: { days: 14, next_number: 41, last_number: 40, last_date: iso(11), day: 11, due_in: 3 },
    owner: { id: 7, name: 'Amir' },
    can_act: canAct,
    is_pm: isPM,
    view_only: !canAct,
    scoped,
    regions: scoped ? ['South', 'South East'] : [],
  }
}

export function ready() {
  const sites = Array.from({ length: 41 }, (_, i) => {
    const n = 1 + (i % 3)
    return {
      work_item_id: 100 + i,
      site_code: `E${3400 + i}`,
      site_type: i % 4 ? 'New Site' : 'Add Tech',
      province: PROVINCES[i % 5],
      cra_region: REGIONS[i % 5],
      dt_date: iso(10 + i),
      villages_ready: n,
      villages_total: n,
      villages: Array.from({ length: n }, (_, j) => ({
        id: 1000 + i * 10 + j, code: String(374000 + i * 10 + j), name: `آبادی ${i}-${j}`, reason: REASONS[i % 4],
      })),
    }
  })
  return { counts: summary().ready.reasons, sites, villages: 64 }
}

const letters = (n) => ({
  mtn: { no: `${4800 + n}/1405`, date: iso(14 * (41 - n)), file_id: n },
  ict: n % 3 ? { no: `${9100 + n}`, date: iso(14 * (41 - n) - 6), file_id: null } : { no: null, date: null, file_id: null },
  cra: { no: null, date: null, file_id: null },
})

export function batches() {
  return {
    rows: Array.from({ length: 40 }, (_, i) => {
      const n = 40 - i
      const l = letters(n)
      return {
        number: n, status: n === 38 ? 'follow_up' : n > 38 ? 'sent' : 'closed', imported: n < 38,
        mtn_letter_date: l.mtn.date, letters: l, letters_recorded: 1 + (l.ict.no ? 1 : 0),
        mojri: n > 38 ? { in_mojri: 40, waiting: 24, follow_up: 0 } : { in_mojri: 90, waiting: 0, follow_up: n === 38 ? 6 : 0 },
        villages: 64 + n, sites: 41,
      }
    }),
  }
}

function villages(n, sent) {
  return Array.from({ length: 64 }, (_, i) => ({
    item_id: n * 1000 + i, village_id: 5000 + i, village_code: String(252000 + i), village_name: `آبادی ${i}`,
    work_item_id: 100 + Math.floor(i / 2), site_code: `E${8500 + Math.floor(i / 2)}`, site_type: 'New Site',
    province: PROVINCES[i % 5], cra_region: REGIONS[i % 5], reason: 'new_dt',
    mojri: sent ? ['in_mojri', 'waiting', 'follow_up'][i % 3] : null,
  }))
}

export function batch(number, { draft = false } = {}) {
  return {
    number, status: draft ? 'draft' : 'sent', imported: false, sent_at: draft ? null : `${iso(11)}T09:00:00Z`,
    letters: draft ? { mtn: { no: null, date: null, file_id: null }, ict: { no: null, date: null, file_id: null }, cra: { no: null, date: null, file_id: null } } : letters(number),
    mojri: draft ? null : { in_mojri: 22, waiting: 21, follow_up: 21 },
    villages_count: 64, sites_count: 32,
    regions: [{ name: 'South East', count: 38 }, { name: 'South', count: 13 }, { name: 'North', count: 13 }],
    days_since_sent: draft ? null : 11, follow_up_days: 30,
    excel_filename: `MTN_Irancell_Drive_Test_${number}.xlsx`,
    villages: villages(number, !draft),
  }
}

export function followUp() {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    item_id: 900 + i, batch_number: 38, village_id: 7000 + i, site_code: `E${4100 + i}`, site_type: 'New Site',
    village_code: String(93800 + i), village_name: `آبادی ${i}`, province: PROVINCES[i % 5], cra_region: REGIONS[i % 5],
    sent_at: iso(41 - i), waiting_days: 41 - i, raised_at: i < 3 ? `${iso(2)}T08:00:00Z` : null, raised_note: null,
  }))
  return { rows, late: 9, oldest_days: 41, raised: 3, not_raised: 6 }
}

export function yourVillages() {
  const statuses = ['in_draft', 'ready', 'waiting', 'follow_up', 'in_mojri']
  return {
    rows: Array.from({ length: 60 }, (_, i) => ({
      village_id: 8000 + i, site_code: `E${2100 + i}`, site_type: 'New Site', village_code: String(70300 + i),
      village_name: `آبادی ${i}`, province: PROVINCES[i % 2], cra_region: REGIONS[i % 2],
      status: statuses[i % 5], days: 41, batch_number: 39, outside_uep: false,
      mtn_letter_date: statuses[i % 5] === 'ready' || statuses[i % 5] === 'in_draft' ? null : iso(20), sent_at: iso(20),
    })),
  }
}

export const COORDINATOR = { id: 3, username: 'coord', full_name: 'Farid', role: { name: 'Coordinator' }, must_change_password: false }
export const VIEWER = { id: 4, username: 'viewer', full_name: 'Viewer', role: { name: 'Viewer' }, must_change_password: false }

/** Route /submissions/** after signIn (later routes win), method-aware. */
export async function mockSubmissions(page, { role = 'owner', calls = [] } = {}) {
  const scoped = role === 'coordinator'
  const canAct = role === 'owner' || role === 'pm'
  await page.route('**/api/v1/submissions/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/v1/submissions', '')
    const method = req.method()
    calls.push(`${method} ${path}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (method === 'POST' && path === '/batches') return json({ number: 41 }, 201)
    if (method !== 'GET') return json({ status: 'ok' })
    if (path === '/summary') return json(summary({ scoped, canAct, isPM: role === 'pm' }))
    if (path === '/ready') return json(ready())
    if (path === '/batches') return json(batches())
    if (path === '/follow-up') return json(followUp())
    if (path === '/villages') return json(yourVillages())
    const m = /^\/batches\/(\d+)$/.exec(path)
    if (m) return json(batch(Number(m[1]), { draft: Number(m[1]) === 41 }))
    return json({ rows: [] })
  })
}
