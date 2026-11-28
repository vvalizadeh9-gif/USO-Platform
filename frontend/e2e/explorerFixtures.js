// GET /explorer/sites/{id} for the layout tests. The site id picks the case:
// 1, 3, 5, 10, 15 or 25 villages; 98 is 25 villages with long Persian names
// (UEP-30 §6); 99 is a site with long Persian village names and no on-air,
// health check or DT date (UEP-28 §E).
import { VILLAGES, manyVillages, record, sitesPage, village, side } from '../src/pages/explorer/fixtures.js'

const LONG = 'روستای حسین آباد علیا و سفلی بخش مرکزی شهرستان'

function undated() {
  const r = record({
    villages: [1, 2, 3].map((i) => village(`V3000${i}`, side('pending', { phase: 'not_filed', filed: false }), side('pending', { phase: 'not_filed', filed: false }), { name: `${LONG} ${i}` })),
  })
  r.general = { ...r.general, on_air_date: null, dt_date: null }
  r.journey.steps = r.journey.steps.map((s) => (s.state === 'done' ? { ...s, date: null, gap_days: null } : { ...s, gap_days: null }))
  r.journey.aging = { total_days: null, oldest_pending: null }
  return r
}

export function explorerSite(url) {
  const id = Number(new URL(url).pathname.split('/').pop())
  const base = id === 99 ? undated()
    : id === 98 ? record({ villages: manyVillages(25).map((v, i) => ({ ...v, name: `${LONG} ${i + 1}` })) })
      : record({ villages: id === 3 ? VILLAGES : manyVillages(id) })
  return { ...base, id, site_code: `W43${String(id).padStart(2, '0')}` }
}

/** GET /explorer/sites: 4,201 sites, fifty a page, as the real list. */
export function explorerSites(url) {
  const params = new URL(url).searchParams
  return sitesPage({
    total: 4201,
    limit: Number(params.get('limit') || 50),
    cursor: params.get('cursor'),
    q: params.get('q') || '',
  })
}
