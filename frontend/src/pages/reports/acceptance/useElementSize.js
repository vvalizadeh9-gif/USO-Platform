import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The real pixel size of the element `ref` is attached to, kept current as it
 * resizes. The chart draws in these units -- one SVG unit is one CSS pixel --
 * so a font size declared inside it is the size it renders at, and the chart
 * fills its card exactly rather than stretching a fixed drawing.
 *
 * `fallback` is used until the first measurement, and wherever there is no
 * layout to measure (jsdom in the tests reports 0).
 */
export default function useElementSize(fallback = { width: 720, height: 300 }) {
  const ref = useRef(null)
  const [size, setSize] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const width = Math.round(el.clientWidth)
      const height = Math.round(el.clientHeight)
      if (width > 0 && height > 0) {
        setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
