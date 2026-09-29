import { useCallback, useRef } from 'react'

/**
 * One stable setter per badge key, for tabs that report their own size
 * (`onCountChange`).
 *
 * The page used to hand each tab `setCount('pool')` -- a new function on every
 * render. A tab whose effect depended on it refetched on every render, and
 * because each fetch set a count and re-rendered the page, it refetched
 * forever (HC In Progress did). Cached per key, the setter is the same
 * function for the life of the page; and a count that did not change does not
 * re-render anything.
 */
export default function useCountSetters(setCounts) {
  const cache = useRef(new Map())
  return useCallback(
    (key) => {
      if (!cache.current.has(key)) {
        cache.current.set(key, (value) =>
          setCounts((c) => (c[key] === value ? c : { ...c, [key]: value })),
        )
      }
      return cache.current.get(key)
    },
    [setCounts],
  )
}
