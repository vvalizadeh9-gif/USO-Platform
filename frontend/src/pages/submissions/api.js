// Acceptance › Submissions (UEP-21): every call the page makes, in one place.
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'

const BASE = '/submissions'
const get = (path, params) => api.get(`${BASE}${path}`, { params }).then((r) => r.data)
const post = (path, body) => api.post(`${BASE}${path}`, body).then((r) => r.data)

function form(fields) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') data.append(key, value)
  }
  return data
}

export const fetchSummary = () => get('/summary')
export const fetchReady = (params) => get('/ready', params)
export const fetchBatches = () => get('/batches')
export const fetchBatch = (number) => get(`/batches/${number}`)
export const fetchFollowUp = () => get('/follow-up')
export const fetchVillages = () => get('/villages')
export const fetchOwnerCandidates = () => get('/owner/candidates')

export const createDraft = (villageIds) => post('/batches', { village_ids: villageIds })
export const removeVillage = (number, villageId) => api.delete(`${BASE}/batches/${number}/villages/${villageId}`)
export const cancelDraft = (number) => post(`/batches/${number}/cancel`)
export const markSent = (number, { no, date, file }) =>
  post(`/batches/${number}/send`, form({ mtn_letter_no: no, mtn_letter_date: date, file }))
export const addLetter = (number, kind, { no, date, file }) =>
  post(`/batches/${number}/letters/${kind}`, form({ no, date, file }))
export const markRaised = (itemIds, note) => post('/follow-up/raise', { item_ids: itemIds, note: note || null })
export const sendAgain = (itemIds) => post('/follow-up/resend', { item_ids: itemIds })
export const setOwner = (userId) => api.put(`${BASE}/owner`, { user_id: userId }).then((r) => r.data)
export const previewImport = (file) => post('/import/preview', form({ file }))
export const commitImport = (file, { digest, date, no, number }) =>
  post('/import/commit', form({ file, digest, mtn_letter_date: date, mtn_letter_no: no, number }))

/** Download a file the server names; throws a readable message on failure. */
export async function download(path, fallback) {
  try {
    const res = await api.get(`${BASE}${path}`, { responseType: 'blob' })
    saveBlob(res.data, filenameFrom(res.headers, fallback))
  } catch (err) {
    throw new Error(await describeBlobError(err))
  }
}
