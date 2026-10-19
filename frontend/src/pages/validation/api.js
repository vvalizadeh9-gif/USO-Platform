// The validation pages' endpoints (UEP-16 §6; docs/design/my-work-api.md §11).
import api from '../../api/client'
import { filenameFrom, saveBlob } from '../../lib/download'
import { REVIEW_PATH } from '../mywork/api'

const BASE = '/acceptance/my-work'

export { REVIEW_PATH }

/** One authority's waiting filings, grouped by letter or site. */
export const fetchValidation = (params) => api.get(`${BASE}/validation`, { params }).then((r) => r.data)

/** One letter (its authority only) or one site (both authorities, apart). */
export const fetchGroup = (group, key, authority) => api
  .get(`${BASE}/validation/${group}/${key.split('/').map(encodeURIComponent).join('/')}`, { params: { authority } })
  .then((r) => r.data)

/** Confirm or return: `{ authority, decision, items, shared_reason?, evidence_checked_outside? }`. */
export const reviewFilings = (body) => api.post(REVIEW_PATH, body).then((r) => r.data)

/** The address the viewer frames or shows: inline for a PDF or an image. */
export const evidenceUrl = (id) => `/api/v1${BASE}/evidence/${id}`

/** An email attachment's address; PDFs and images open inline. */
export const attachmentUrl = (id, index) => `/api/v1${BASE}/evidence/${id}/email/attachments/${index}`

/** The parsed email: headers, plain-text body, attachments. Never its HTML. */
export const fetchEmail = (id) => api.get(`${BASE}/evidence/${id}/email`).then((r) => r.data)

async function save(path, params, fallback) {
  const r = await api.get(path, { params, responseType: 'blob' })
  saveBlob(r.data, filenameFrom(r.headers, fallback))
}

export const downloadEvidence = (file) => save(`${BASE}/evidence/${file.id}/download`, undefined, file.filename)

export const downloadAttachment = (id, attachment) => save(
  `${BASE}/evidence/${id}/email/attachments/${attachment.index}`, { download: true }, attachment.filename,
)

/** Every file of one letter as one zip named after it. */
export const downloadLetterZip = (authority, letterNumber) => save(
  `${BASE}/letters/evidence.zip`, { authority, letter_number: letterNumber },
  `${authority}-${letterNumber.replaceAll('/', '-')}.zip`,
)
