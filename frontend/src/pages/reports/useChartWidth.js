import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The real pixel width of the element `ref` is attached to, kept current as
 * it resizes.
 *
 * WHY. The Acceptance charts used to draw into a fixed 640-unit viewBox and
 * then stretch to the card, so every label inside them was scaled by
 * card-width / 640 — an 11.5px axis label rendered at 8–9px in a narrow card.
 * Sizing the viewBox from this width makes one SVG unit one CSS pixel, so a
 * font size declared inside the chart is the size it renders at.
 *
 * `fallback` is used until the first measurement, and wherever there is no
 * layout to measure (jsdom in the tests reports 0).
 */
export default function useChartWidth(fallback = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const w = Math.round(el.clientWidth)
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
