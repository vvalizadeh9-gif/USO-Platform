// Acceptance › Filing and Insights › Acceptance baskets (UEP-22): every call.
import api from '../../api/client'

const get = (path, params) => api.get(path, { params }).then((r) => r.data)

export const fetchInbox = (params) => get('/acceptance/inbox', params)
export const fetchCase = (villageId, authority) => get(`/acceptance/cases/${villageId}`, { authority })
export const fetchHistory = (villageId, authority) => get(`/acceptance/cases/${villageId}/history`, { authority })
export const fetchCategories = () => get('/acceptance/categories')
export const saveUpdate = (body) => api.post('/acceptance/cases/update', body).then((r) => r.data)
export const changeBasket = (caseId, body) => api.post(`/acceptance/cases/${caseId}/basket`, body).then((r) => r.data)
/** UEP-24 F10: a basket owner comments on, or marks fixed, its own case. */
export const ownerAction = (caseId, body) => api.post(`/acceptance/cases/${caseId}/owner`, body).then((r) => r.data)

/** A letter file, through the evidence store (the one storage path). */
export function uploadScan(file) {
  const form = new FormData()
  form.append('file', file)
  return api.post('/acceptance/scans', form).then((r) => r.data)
}

export const fetchBaskets = (authority) => get('/insights/acceptance-baskets', { authority })
export const fetchBasketCell = (params) => get('/insights/acceptance-baskets/cell', params)
