// Central API client. Attaches the JWT to every request and handles
// 401s by clearing the session, so auth logic lives in one place (DRY).
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('uep_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('uep_token')) {
      localStorage.removeItem('uep_token')
      localStorage.removeItem('uep_user')
      window.location.href = '/login'
    }
    // FastAPI's own validation errors (422 -- a field failing min_length,
    // for example) return `detail` as a list of objects, not a string. Every
    // page's error handler assumes a string and hands it straight to a toast,
    // so an array there crashes the render instead of showing a message.
    // Normalized once, here, so every page gets a string either way.
    const detail = err.response?.data?.detail
    if (Array.isArray(detail)) {
      err.response.data.detail = detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
    }
    return Promise.reject(err)
  }
)

export default api
