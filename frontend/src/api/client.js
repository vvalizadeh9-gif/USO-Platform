// Central API client. Attaches the JWT to every request and handles the two
// server answers that mean "you cannot continue on this page", so that auth
// logic lives in one place (DRY).
import axios from 'axios'
import { isPasswordChangeRequired } from '../lib/apiError'

const api = axios.create({ baseURL: '/api/v1' })

// Where the interface sends someone whose password an administrator has reset.
const CHANGE_PASSWORD_PATH = '/change-password'

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

    // A 403 is normally "you may not do this", and the session survives it.
    // One 403 means something else: the account is on a password an
    // administrator issued and may do nothing until it is replaced. Without
    // this the person sees a permission error on every screen, which reads as
    // a fault rather than as an instruction.
    //
    // Guarded against redirecting while already on that screen -- its own
    // requests would otherwise reload the page in a loop.
    if (
      isPasswordChangeRequired(err)
      && !window.location.pathname.startsWith(CHANGE_PASSWORD_PATH)
    ) {
      window.location.href = CHANGE_PASSWORD_PATH
    }

    return Promise.reject(err)
  }
)

export default api
