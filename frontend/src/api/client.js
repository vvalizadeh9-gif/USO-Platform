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
    return Promise.reject(err)
  }
)

export default api
