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

/** A trend line drawn at the size of a word.
 *
 * No axes, no gridlines, no labels, no interaction. A sparkline answers
 * "which way, and how steadily" beside a figure that has already answered
 * "how much". Anything more turns it into a second chart competing with the
 * number it belongs to.
 *
 * NORMALISED TO ITS OWN RANGE, not to zero, which is the opposite of what
 * the flow chart does and is deliberate in both places. A programme running
 * 1,180 to 1,240 against a zero baseline draws a flat line that says nothing
 * true; against its own min and max it shows the shape that is actually
 * there. The trade is that two sparklines in this band are not on a shared
 * scale and must never be read against each other — they each carry their
 * own figure, so there is nothing to compare across them anyway. The flow
 * chart draws two series a reader is explicitly meant to compare, so it
 * keeps its zero.
 *
 * A flat series is drawn flat, down the middle, rather than divided by a
 * zero span.
 */
export function Sparkline({ points, color, width = 78, height = 26, label }) {
  const reduced = useReducedMotion()
  if (!points || points.length < 2) return null

  const pad = 3
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo
  const stepX = width / (points.length - 1)
  const mid = height / 2
  const y = (v) =>
    span === 0 ? mid : height - pad - ((v - lo) / span) * (height - pad * 2)

  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ')
  const lastX = width - 0.5
  const lastY = y(points[points.length - 1])

  return (
    <svg
      className="dt-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-testid="dt-spark"
    >
      <DrawPath d={d} stroke={color} strokeWidth={1.75} />
      {/* The head of the line, so the eye lands on "now" rather than on the
          middle of the stroke. */}
      <motion.circle
        cx={lastX}
        cy={lastY}
        r={2.4}
        fill={color}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.8 }}
      />
    </svg>
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
