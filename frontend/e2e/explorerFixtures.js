// GET /explorer/sites/{id} for the layout tests. The site id picks how many
// villages it has (3, 6 or 10), so one route serves every board in the
// approved design: B4 (3), B5 (6) and B6 (more than 6).
import { VILLAGES, manyVillages, record, side, sitesPage, village } from '../src/pages/explorer/fixtures.js'

const sixVillages = () => [
  ...VILLAGES,
  village('V10004', side('pending', { phase: 'with_authority', filed_date: '2026-10-05', days: 9 }), side('approved', { decided_date: '2026-10-08' })),
  village('V10005', side('approved', { decided_date: '2026-10-03', filed_date: '2026-09-28', days: 5 }), side('pending', { phase: 'returned', decided_date: '2026-10-09', days: 5 })),
  village('V10006', side('approved', { decided_date: '2026-10-01' }), side('approved', { decided_date: '2026-10-02' })),
]

export function explorerSite(url) {
  const id = Number(new URL(url).pathname.split('/').pop())
  const villages = id === 6 ? sixVillages() : id === 10 ? manyVillages(10) : VILLAGES
  return { ...record({ villages }), id, site_code: `W43${String(id).padStart(2, '0')}` }
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
