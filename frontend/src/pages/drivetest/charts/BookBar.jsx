import { motion, useReducedMotion } from 'framer-motion'
import { count } from '../format'

/**
 * One row's book of work: how big it is, and what state it is in.
 *
 * TWO ENCODINGS, ON PURPOSE. The bar's **length** is the size of the book
 * against the largest book on screen; the **fill** is how that book splits.
 * A plain percentage bar carries only the second, and that is what made the
 * old scorecard misleading in the one way a scorecard must not be: a company
 * holding twelve sites and a company holding four hundred drew the identical
 * 62% bar, so the reader's eye ranked two completely different situations as
 * the same. Here the four-hundred-site row is thirty times longer, and how
 * far the green runs along it is the rate.
 *
 * Segments are separated by a 2px gap in the surface colour rather than by a
 * stroke — white doing the separating, no ink that is not data.
 *
 * Shared by the contractor scorecard and the province table so the two read
 * the same way. What goes into the segments differs (a contractor's book is
 * their assignment; a province's is every on-air site in it) and that is the
 * caller's business, not this component's.
 */
export default function BookBar({ segments, total, scaleMax, index = 0, label, height }) {
  const reduced = useReducedMotion()
  const shown = segments.filter((s) => s.value > 0)
  const width = scaleMax > 0 ? (total / scaleMax) * 100 : 0

  return (
    <span
      className="dt-book"
      role="img"
      aria-label={
        `${label ? `${label}: ` : ''}${count(total)} — ` +
        shown.map((s) => `${s.label} ${s.value}`).join(', ')
      }
    >
      <motion.span
        className="dt-book-bar"
        style={{ width: `${Math.max(width, 1.5)}%`, ...(height ? { height } : null) }}
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{
          duration: 0.5,
          delay: Math.min(index * 0.04, 0.3),
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {shown.map((seg) => (
          <span
            key={seg.key}
            data-testid="dt-bar"
            data-segment={seg.key}
            className="dt-book-seg"
            style={{
              background: seg.color,
              flexGrow: seg.value,
            }}
            title={`${seg.label}: ${count(seg.value)}`}
          />
        ))}
      </motion.span>
    </span>
  )
}
