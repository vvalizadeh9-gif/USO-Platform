// A GET /explorer/sites/{id} response for tests, shaped like the server's.

export const side = (status, over = {}) => ({
  status,
  phase: { approved: 'decided', rejected: 'rejected', pending: 'with_coordinator' }[status],
  filed_date: null,
  decided_date: null,
  days: null,
  round: 1,
  filed: true,
  refiled: false,
  ...over,
})

export const village = (code, ict, cra, over = {}) => ({
  id: Number(code.replace(/\D/g, '')),
  code,
  name: `روستای ${code}`,
  ict,
  cra,
  ...over,
})

/** Three villages: one approved, one rejected on ICT, one re-filed. */
export const VILLAGES = [
  village('V10001', side('approved', { decided_date: '2026-10-04', filed_date: '2026-09-30', days: 4 }), side('approved', { decided_date: '2026-10-06' })),
  village('V10002', side('rejected', { decided_date: '2026-10-02' }), side('pending', { filed_date: '2026-10-07', days: 7 })),
  village('V10003', side('pending', { filed_date: '2026-10-10', days: 4, round: 2, refiled: true }), side('pending', { phase: 'not_filed', filed: false, days: 14, round: null })),
]

const countOf = (villages, key) => {
  const out = { approved: 0, pending: 0, rejected: 0 }
  for (const v of villages) out[v[key].status] += 1
  return out
}

export function record({ villages = VILLAGES, ...over } = {}) {
  return {
    id: 7,
    site_code: 'W4318',
    status: { step: 'acceptance', state: 'in_progress' },
    general: {
      on_air_date: '2026-09-02',
      dt_date: '2026-09-30',
      site_contractor: 'سازه گستر',
      dt_contractor: 'آریا موج',
      requested_technology: ['3G', '4G'],
      province: 'کرمان',
      hadaf_villages: villages.length,
    },
    journey: {
      steps: [
        { key: 'on_air', state: 'done', date: '2026-09-02', gap_days: null },
        { key: 'health_check', state: 'done', date: '2026-09-09', gap_days: 7 },
        { key: 'assigned', state: 'done', date: '2026-09-16', gap_days: 7 },
        { key: 'dt_done', state: 'done', date: '2026-09-30', gap_days: 14 },
        { key: 'acceptance', state: 'in_progress', date: null, gap_days: 14 },
      ],
      aging: {
        total_days: 42,
        current_step_days: 14,
        longest_step: { from: 'assigned', to: 'dt_done', days: 14 },
        oldest_pending: { authority: 'CRA', days: 14, villages: 2 },
      },
    },
    acceptance_started: true,
    villages,
    counts: { ict: countOf(villages, 'ict'), cra: countOf(villages, 'cra') },
    workflow: { current_stage: 'DT Done', active_drive_test_id: 3, dt_submission_date: '2026-09-30' },
    ...over,
  }
}

/** `n` villages, every one pending on both sides, waiting `i` days. */
export const manyVillages = (n) =>
  Array.from({ length: n }, (_, i) =>
    village(`V2${String(i).padStart(4, '0')}`, side('pending', { filed_date: '2026-10-01', days: i }), side('approved', { decided_date: '2026-10-02' })),
  )
