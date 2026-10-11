// The CSRF token for the cookie session.
//
// Signing in sets two cookies: the session itself, which is HttpOnly and never
// visible here, and `uep_csrf`, which is readable on purpose. Every request
// that can change something echoes it in a header; another site can make the
// browser send the cookies but cannot read this one, so it cannot forge the
// header. See backend/app/core/session_cookies.py.
export const CSRF_COOKIE = 'uep_csrf'
export const CSRF_HEADER = 'X-CSRF-Token'

const SAFE_METHODS = new Set(['get', 'head', 'options'])

/** @param {string | undefined} method */
export const isUnsafeMethod = (method) => !SAFE_METHODS.has((method || 'get').toLowerCase())

/**
 * @param {string} cookieString  e.g. `document.cookie`
 * @returns {string | null}
 */
export function readCsrfToken(cookieString = document.cookie) {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

/**
 * The header to add to a request, or none.
 * @param {string | undefined} method
 * @returns {Record<string, string>}
 */
export function csrfHeaders(method) {
  if (!isUnsafeMethod(method)) return {}
  const token = readCsrfToken()
  return token ? { [CSRF_HEADER]: token } : {}
}
