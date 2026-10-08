// Where to send someone after they sign in.
//
// Anyone sent to the sign-in screen from a page -- a signed-out bookmark, a
// session that expired mid-task -- comes back to that page afterwards, the way
// Google and Microsoft do it. The page travels in the query string
// (`/login?next=/my-work?village=12`) rather than in router state, because one
// of the two routes here is a hard redirect from the API client, which keeps
// no state.
//
// A value in the URL is input from whoever wrote the link, so it is only ever
// followed when it is a path on this site. Anything else -- another origin, a
// protocol-relative `//host`, a `/\host` that some browsers read as one, a
// `javascript:` URL -- is dropped and the person lands on the home page.
const LOGIN_PATH = '/login'
const NEXT_PARAM = 'next'

// Any origin will do as the base, as long as it is one no real path resolves
// away from. If the resolved URL is still on it, the candidate was a path.
const PROBE_ORIGIN = 'https://uep.invalid'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/**
 * Return `candidate` if it is a path on this site worth returning to, else null.
 *
 * @param {unknown} candidate
 * @returns {string | null}
 */
export function safeReturnPath(candidate) {
  if (typeof candidate !== 'string' || !candidate.startsWith('/')) return null
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null
  if (CONTROL_CHARACTERS.test(candidate)) return null

  let url
  try {
    url = new URL(candidate, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN) return null
  // Returning to the sign-in screen itself would only loop.
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith(`${LOGIN_PATH}/`)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The sign-in URL for someone leaving `location`, carrying it as `next`.
 *
 * @param {{ pathname: string, search?: string, hash?: string }} location
 * @returns {string}
 */
export function loginPathFor({ pathname, search = '', hash = '' }) {
  const target = safeReturnPath(`${pathname}${search}${hash}`)
  // The home page is where sign-in goes anyway; no need to say so.
  if (!target || target === '/') return LOGIN_PATH
  return `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(target)}`
}

/**
 * The page to go to after signing in, read from the sign-in URL's query string.
 *
 * @param {string} search  e.g. `location.search`
 * @returns {string | null}  null means "the home page"
 */
export function returnPathFrom(search) {
  return safeReturnPath(new URLSearchParams(search).get(NEXT_PARAM))
}
