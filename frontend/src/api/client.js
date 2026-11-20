// Central API client. The session is an HttpOnly cookie the browser sends on
// its own; this adds the CSRF header to every write and handles the two
// server answers that mean "you cannot continue on this page", so that auth
// logic lives in one place (DRY).
import axios from 'axios'
import { isPasswordChangeRequired } from '../lib/apiError'
import { csrfHeaders } from '../lib/csrf'
import { DATA_CHANGED_EVENT } from '../lib/dataChanged'
import { SESSION_EXPIRED, loginPathFor } from '../lib/returnTo'
import { resetClientSession } from '../lib/session'

const api = axios.create({ baseURL: '/api/v1' })

// Where the interface sends someone whose password an administrator has reset.
const CHANGE_PASSWORD_PATH = '/change-password'

api.interceptors.request.use((config) => {
  Object.assign(config.headers, csrfHeaders(config.method))
  return config
})

const READ_METHODS = new Set(['get', 'head', 'options'])

api.interceptors.response.use(
  (res) => {
    const method = (res.config?.method || 'get').toLowerCase()
    if (!READ_METHODS.has(method)) {
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
    }
    return res
  },
  (err) => {
    // A session that ran out mid-task. Everything kept for it is cleared, and
    // the sign-in page says why they are there; signing in again lands on the
    // home page (UEP-19). Only when there was a session to lose: a failed
    // sign-in is a 401 too.
    if (err.response?.status === 401 && localStorage.getItem('uep_user')) {
      resetClientSession()
      window.location.href = loginPathFor(window.location, { reason: SESSION_EXPIRED })
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
