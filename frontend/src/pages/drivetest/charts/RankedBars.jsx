import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { count, share } from '../format'
import { DrillLink } from '../DrillPanel'

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
 *
 * `color` takes a function as well as a string. On the dashboard every bar is
 * the accent: the bar is a share, and the card's title names the state.
 *
 * A folded row ("6 more provinces", `muted`) and an "Uncategorized" row
 * (`quiet`) are not a category of their own, so they read as one: an italic
 * name and the darker neutral bar. Only a folded row loses its link -- there
 * is no one list behind "6 more".
 *
 * Farsi names take the 15px Vazirmatn the rest of the page uses for Farsi
 * data; English names stay at 14px.
 */
const FARSI = /[\u0600-\u06FF]/

export default function RankedBars({ points, total, color, hrefFor, emptyLabel = 'No data yet' }) {
  const reduced = useReducedMotion()
  if (!points || points.length === 0) {
    return <div className="dt-empty">{emptyLabel}</div>
  }

  const widest = Math.max(1, ...points.map((p) => p.value))
  const colorAt = (point, i) => (typeof color === 'function' ? color(point, i) : color)

  return (
    <ul className="dt-bars">
      {points.map((p, i) => {
        const href = p.muted ? null : hrefFor?.(p)
        const folded = p.muted || p.quiet
        const body = (
          <>
            <span className={`dt-bar-label${FARSI.test(p.name) ? ' dt-farsi' : ''}`} title={p.name}>
              {p.name}
            </span>
            <span className="dt-track" aria-hidden="true">
              <motion.span
                data-testid="dt-bar"
                className="dt-track-fill"
                style={{
                  background: folded ? 'var(--dt-pending-bar)' : colorAt(p, i),
                  width: `${(p.value / widest) * 100}%`,
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
          <li key={`${p.name}-${i}`} className={`dt-bar-row${folded ? ' dt-muted' : ''}`}>
            {href ? (
              <DrillLink
                to={href}
                className="dt-bar-link"
                drillLabel={p.name}
                aria-label={`${p.name}: ${p.value} sites`}
              >
                {body}
              </DrillLink>
            ) : (
              <span className="dt-bar-link dt-bar-static">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
