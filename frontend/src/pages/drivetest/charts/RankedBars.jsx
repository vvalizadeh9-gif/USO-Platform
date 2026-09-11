import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { count, share } from '../format'

/**
 * A ranked list of quantities, each one a link to the sites behind it.
 *
 * Horizontal rather than vertical because every label in these views is a
 * phrase — a Persian company name, a province, "Returned by Contractor" — and
 * vertical bars would rotate them into illegibility.
 *
 * Two changes from the bars this replaces. The track is now visible against
 * the card behind it (it was `--surface-3` on `--surface-1`, a two per cent
 * difference, so the unfilled remainder never read and the bars floated with
 * no scale). And a row with a destination is a link: the whole row, not a
 * small chevron, so the target is the size of the thing you are looking at.
 */
export default function RankedBars({ points, total, color, hrefFor, emptyLabel = 'No data yet' }) {
  const reduced = useReducedMotion()
  if (!points || points.length === 0) {
    return <div className="dt-empty">{emptyLabel}</div>
  }

  const widest = Math.max(1, ...points.map((p) => p.value))

  return (
    <ul className="dt-bars">
      {points.map((p, i) => {
        const href = p.muted ? null : hrefFor?.(p)
        const body = (
          <>
            <span className="dt-bar-label dt-farsi" title={p.name}>
              {p.name}
            </span>
            <span className="dt-track" aria-hidden="true">
              <motion.span
                data-testid="dt-bar"
                className="dt-track-fill"
                style={{
                  background: color,
                  width: `${(p.value / widest) * 100}%`,
                  opacity: p.muted ? 0.45 : 1,
                  transformOrigin: 'left center',
                }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
            <span className="dt-bar-value tnum">{count(p.value)}</span>
            <span className="dt-bar-share tnum">{share(p.value, total)}</span>
            {href && <ChevronRight size={14} className="dt-bar-go" aria-hidden="true" />}
          </>
        )

        return (
          <li key={`${p.name}-${i}`} className={`dt-bar-row${p.muted ? ' dt-muted' : ''}`}>
            {href ? (
              <Link to={href} className="dt-bar-link" aria-label={`${p.name}: ${p.value} sites`}>
                {body}
              </Link>
            ) : (
              <span className="dt-bar-link dt-bar-static">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
