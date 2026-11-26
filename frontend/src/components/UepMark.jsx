// The UEP mark (UEP-26): a corner with three signal arcs, the same waves the
// sign-in band carries. Inline rather than an <img> so the arcs can draw in.
// The files in src/assets/ are the same drawing, for the header and favicon.
//
// Decorative: it always sits beside the "UEP" wordmark, which names it.

const ARCS = [
  'M7 16.2a6.8 6.8 0 0 1 6.8 6.8',
  'M7 9.6a13.4 13.4 0 0 1 13.4 13.4',
  'M7 3.2a19.8 19.8 0 0 1 19.8 19.8',
]

/**
 * @param {{ size?: number, onDark?: boolean, animated?: boolean, className?: string }} props
 *   onDark: white tile with cobalt arcs, for the deep cobalt band.
 *   animated: each arc carries `uep-mark-arc` and its index, for the draw-in.
 */
export default function UepMark({ size = 30, onDark = false, animated = false, className }) {
  const tile = onDark ? 'var(--uep-on-brand)' : 'var(--uep-accent)'
  const arc = onDark ? 'var(--uep-accent)' : 'var(--uep-on-accent)'
  const outerOpacity = onDark ? 0.38 : 0.45
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 30 30"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="30" height="30" rx="7" style={{ fill: tile }} />
      {ARCS.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity={i === 2 ? outerOpacity : undefined}
          className={animated ? 'uep-mark-arc' : undefined}
          style={{ stroke: arc, ...(animated ? { '--uep-arc': i } : null) }}
        />
      ))}
    </svg>
  )
}
