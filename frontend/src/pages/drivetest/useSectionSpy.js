import { useEffect, useState } from 'react'

/**
 * Which panel the reader is currently in, for the bench rail to mark.
 *
 * Observes the panels rather than listening to scroll: a scroll handler has to
 * measure every panel on every frame to answer the same question, and answers
 * it late. The rail is a position indicator, so being a frame behind is the
 * one thing it cannot be.
 *
 * `rootMargin` pulls the detection line up to just under the sticky command
 * bar. Without it the panel scrolled to sits *behind* the bar at the moment it
 * is reported as current, and the rail marks the panel above the one the
 * reader is looking at.
 *
 * Returns null where the browser has no IntersectionObserver — jsdom under the
 * test runner, and old browsers. The rail then renders as plain jump links
 * with nothing marked, which is degraded but not broken; it is still a working
 * table of contents. Guarding here rather than at the call site keeps the
 * fallback in one place.
 */
export function useSectionSpy(ids) {
  const [active, setActive] = useState(null)

  // Joined because the array identity changes on every render of the caller,
  // and depending on the array itself would tear down and rebuild the
  // observer on each one.
  const key = ids.join('|')

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined

    const targets = key
      .split('|')
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
    if (targets.length === 0) return undefined

    // Kept outside the callback: an entry only fires when it *crosses* the
    // line, so a panel that is still on screen from a previous callback sends
    // nothing this time and would otherwise be forgotten.
    const visible = new Map()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top)
          else visible.delete(entry.target.id)
        }
        if (visible.size === 0) return
        // The topmost panel still on screen, which is the one being read.
        // Not the largest: a short panel fully in view would otherwise lose to
        // a tall one whose bottom edge is only just showing.
        const [topmost] = [...visible.entries()].sort((a, b) => a[1] - b[1])
        setActive(topmost[0])
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: 0 },
    )

    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [key])

  return active
}
