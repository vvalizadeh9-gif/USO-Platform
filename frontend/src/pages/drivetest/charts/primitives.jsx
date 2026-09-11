import { animate, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { count as fmtCount } from '../format'

// Small animated pieces shared by the charts.
//
// Every one of them takes the same position on motion: the resting state is
// the true state, and the animation is the journey to it. A reader who has
// asked their system for reduced motion, or a screenshot taken the instant
// the page loads, gets the finished figure rather than a zero — which is also
// why the suite runs with reduced motion on and can assert on real values.

/** A figure that counts up to its value.
 *
 * Driven by React state rather than a MotionValue rendered as a child: the
 * number then lives in the DOM as text at every frame, so it is readable by
 * assistive technology and assertable by a test, neither of which is true of
 * a value the animation library paints directly into the node.
 */
export function AnimatedNumber({ value, format = fmtCount, duration = 0.9, className = 'tnum' }) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return undefined
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, reduced, duration])

  return <span className={className}>{format(display)}</span>
}

/** A horizontal bar that grows from its left edge.
 *
 * `transformOrigin` is set explicitly rather than left to the default centre:
 * a bar that grows outward from its middle reads as a range, not a quantity.
 */
export function GrowBar({ width, color, delay = 0, muted, title, height = 10 }) {
  const reduced = useReducedMotion()
  return (
    <div
      className="dt-track"
      style={{ height }}
      role="presentation"
      title={title}
    >
      <motion.div
        data-testid="dt-bar"
        className="dt-track-fill"
        style={{ background: color, opacity: muted ? 0.45 : 1, transformOrigin: 'left center' }}
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ width: `${width}%`, height: '100%', background: 'inherit', borderRadius: 'inherit' }} />
      </motion.div>
    </div>
  )
}

/** An SVG path that draws itself.
 *
 * `pathLength` animates the stroke dash rather than the geometry, so the line
 * arrives along its own shape instead of sliding or scaling into place. With
 * reduced motion it is simply drawn.
 */
export function DrawPath({ d, stroke, strokeWidth = 2, delay = 0, dashed, ...rest }) {
  const reduced = useReducedMotion()
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? '5 5' : undefined}
      initial={reduced || dashed ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
      {...rest}
    />
  )
}

/** An area fill that fades up under a line. */
export function FadeArea({ d, fill, delay = 0 }) {
  const reduced = useReducedMotion()
  return (
    <motion.path
      d={d}
      fill={fill}
      stroke="none"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7, delay: delay + 0.25 }}
    />
  )
}
