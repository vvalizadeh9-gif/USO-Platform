// The My Work endpoints (docs/design/my-work-api.md), in one place.
import api from '../../api/client'
import { saveBlob } from '../../lib/download'

const BASE = '/acceptance'

export const fetchList = (params) => api.get(`${BASE}/my-work`, { params }).then((r) => r.data)

export const fetchRows = (ids, scope) => fetchList({ ids: ids.join(','), scope, limit: ids.length || 1 })

export const fetchVillage = (id) => api.get(`${BASE}/villages/${id}`).then((r) => r.data)

export const fetchSuggestions = (id, authority, scope) => api
  .get(`${BASE}/villages/${id}/suggestions`, { params: { authority, scope } })
  .then((r) => r.data)

export const resolveCodes = (codes, scope) => api
  .post(`${BASE}/villages/resolve`, { codes, scope })
  .then((r) => r.data)

export function uploadScan(file) {
  const form = new FormData()
  form.append('file', file)
  return api.post(`${BASE}/scans`, form).then((r) => r.data)
}

export const LETTERS_PATH = `${BASE}/letters`
export const REVIEW_PATH = `${BASE}/letters/review`

export const fileLetter = (body) => api.post(LETTERS_PATH, body).then((r) => r.data)
export const reviewLetter = (body) => api.post(REVIEW_PATH, body).then((r) => r.data)

/** Send a request the page is about to lose -- a held send when the tab is
 * closing. `keepalive` lets it outlive the page; axios cannot. */
export function sendNow(path, body) {
  const token = localStorage.getItem('uep_token')
  return fetch(`/api/v1${path}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

/** "View scan": the evidence endpoint needs the bearer token, which a plain
 * link cannot send, so the file is fetched and saved. */
export async function viewScan(evidenceId, filename) {
  const r = await api.get(`${BASE}/evidence/${evidenceId}/download`, { responseType: 'blob' })
  saveBlob(r.data, filename)
}
