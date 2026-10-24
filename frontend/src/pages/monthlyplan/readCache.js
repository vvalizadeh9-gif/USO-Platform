import api from '../../api/client'

/**
 * The Monthly Plan pages' reads, remembered for the life of the browser tab.
 *
 * Every hook still asks the server each time it mounts or its month changes,
 * so what is on screen is never older than the last visit. What this adds is
 * that a page seen before draws at once from the last answer while the new
 * one is on its way, and that a read already in flight is shared rather than
 * sent twice. `prefetch` warms a page before it is opened.
 */
const store = new Map()

const keyOf = (url, params) => `${url}?${JSON.stringify(params ?? {})}`

/** The last answer for this read, or undefined. Never touches the network. */
export function peek(url, params) {
  return store.get(keyOf(url, params))?.data
}

/** GET `url` with `params`; resolves to the response body and remembers it. */
export function read(url, params) {
  const key = keyOf(url, params)
  const hit = store.get(key)
  if (hit?.pending) return hit.pending
  const pending = api.get(url, { params }).then(
    (r) => {
      store.set(key, { data: r.data })
      return r.data
    },
    (err) => {
      if (hit?.data !== undefined) store.set(key, { data: hit.data })
      else store.delete(key)
      throw err
    },
  )
  store.set(key, { data: hit?.data, pending })
  return pending
}

/** Start a read nobody is waiting for yet, unless its answer is already here. */
export function prefetch(url, params) {
  if (peek(url, params) === undefined) read(url, params).catch(() => {})
}

/** Forget everything (tests, and sign-out). */
export function clearReadCache() {
  store.clear()
}
