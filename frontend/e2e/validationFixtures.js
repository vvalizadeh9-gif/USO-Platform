// ICT / CRA validation (UEP-16) served from fixtures: one long ICT letter, one
// site with ICT and CRA filings waiting, and an emailed CRA letter. Shapes
// follow app/api/validation.py.

const NAMES = ['سرآسیاب', 'کهنوج بالا', 'حسین آباد', 'منوجان', 'رضی آباد', 'چاه ماهی', 'قلعه گنج', 'ده نو']

function filing(id, authority, i, extra = {}) {
  const rejected = i % 7 === 0
  const missing = i % 11 === 3
  return {
    submission_id: id, authority, version: 0, village_id: id, village_code: `KR-${1000 + id}-V1`,
    village_name: NAMES[i % NAMES.length], site_id: 41, site_code: 'TB-4471',
    letter_number: authority === 'ICT' ? '1405/3290' : 'CRA/1405/77',
    letter_date: '2026-10-14', letter_date_shamsi: '1405/07/22', requested_techs: ['3G', '4G'],
    claims: missing ? [{ tech: '3G', result: 'approved' }]
      : [{ tech: '3G', result: 'approved' }, { tech: '4G', result: rejected ? 'rejected' : 'approved', reason: rejected ? 'weak signal' : null }],
    missing_techs: missing ? ['4G'] : [], has_rejection: rejected, has_evidence: true,
    waiting_days: 1 + (i % 4), late: i % 4 === 3, ...extra,
  }
}

const ictFilings = Array.from({ length: 40 }, (_, i) => filing(500 + i, 'ICT', i))
  .sort((a, b) => Number(b.has_rejection || b.missing_techs.length > 0) - Number(a.has_rejection || a.missing_techs.length > 0))
const craFilings = Array.from({ length: 3 }, (_, i) => filing(900 + i, 'CRA', i + 1))

const ICT_LETTER = {
  authority: 'ICT', letter_number: '1405/3290', letter_date: '2026-10-14', letter_date_shamsi: '1405/07/22',
  villages: ictFilings.length, without_evidence: 0,
  evidence: [
    { id: 11, filename: 'ict-1405-3290.pdf', kind: 'pdf', content_type: 'application/pdf', size_bytes: 284000, pages: null },
    { id: 12, filename: 'site-photo.jpg', kind: 'image', content_type: 'image/jpeg', size_bytes: 91000, pages: null },
  ],
  duplicate_use: { villages: 2, contractors: 1 },
}
const CRA_LETTER = {
  authority: 'CRA', letter_number: 'CRA/1405/77', letter_date: '2026-10-12', letter_date_shamsi: '1405/07/20',
  villages: craFilings.length, without_evidence: 0,
  evidence: [{ id: 21, filename: 'cra-answer.eml', kind: 'email', content_type: 'message/rfc822', size_bytes: 12000, pages: null }],
  duplicate_use: { villages: 0, contractors: 0 },
}

const contractor = { id: 3, name: 'پیشرو فن' }

function summary(kind) {
  return {
    key: kind === 'letter' ? '1405/3290' : '41', kind, label: kind === 'letter' ? '1405/3290' : 'TB-4471',
    contractor, contractors: 1, province: 'کرمان', letter_date: '2026-10-14', letter_date_shamsi: '1405/07/22',
    waiting_days: 4, late: true, villages: ictFilings.length,
    rejected: ictFilings.filter((f) => f.has_rejection).length, letters: 1,
    other_waiting: kind === 'site' ? craFilings.length : 0,
  }
}

export function validationList(url) {
  const params = new URL(url).searchParams
  const group = params.get('group') || 'letter'
  return {
    authority: params.get('authority') || 'ICT', group, sla_days: 2, next_cursor: null,
    counts: { waiting: ictFilings.length, late: 10, filtered: ictFilings.length, letter: 1, site: 1, has_rejection: 6 },
    groups: [summary(group)],
    contractors: [contractor], provinces: [{ id: 1, name: 'کرمان' }], regions: [{ id: 2, name: 'Region 8' }],
  }
}

export function validationGroup(url) {
  const path = new URL(url).pathname
  const site = path.includes('/validation/site/')
  return {
    authority: 'ICT', sla_days: 2, group: summary(site ? 'site' : 'letter'),
    filings: ictFilings,
    other: site ? { authority: 'CRA', sla_days: 2, filings: craFilings } : null,
    letters: site ? [ICT_LETTER, CRA_LETTER] : [ICT_LETTER],
  }
}

export function validationEmail() {
  return {
    from: 'CRA Region 8 <region8@cra.example>', to: 'پیشرو فن <office@contractor.example>', cc: null,
    date: '2026-10-12T09:30:00+03:30', subject: 'CRA acceptance — TB-4471',
    text_body: 'The villages below are accepted for 3G and 4G.\n\nKR-1900-V1\nKR-1901-V1\nKR-1902-V1',
    attachments: [{ index: 0, filename: 'cra-scan.pdf', content_type: 'application/pdf', size_bytes: 120000, kind: 'pdf' }],
  }
}
