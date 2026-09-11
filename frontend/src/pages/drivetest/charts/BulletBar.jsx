import { motion, useReducedMotion } from 'framer-motion'
import { achievement, bandColor } from '../format'

/**
 * One contractor's delivery against their own plan.
 *
 * The target marker used to be a two-pixel tick whose only explanation was a
 * `title` attribute — hover-only meaning, and nothing at all on a touch
 * screen. It is now a labelled line the row is measured against, stated once
 * above the group rather than on every row.
 *
 * The track runs past 100% so the marker sits inside it — see
 * `format.achievementScale`.
 */
export default function BulletBar({ label, percent, detail, scaleMax, anonymous, index = 0 }) {
  const reduced = useReducedMotion()
  const width = percent == null ? 0 : Math.min(100, (percent / scaleMax) * 100)
  const marker = (100 / scaleMax) * 100
  const color = anonymous ? 'var(--text-dim)' : bandColor(percent)
  const noPlan = percent == null

  return (
    <div className={`dt-bullet${anonymous ? ' dt-anon' : ''}${noPlan ? ' dt-noplan' : ''}`}>
      <span className="dt-bullet-label dt-farsi" title={label}>
        {label}
      </span>
      <span className="dt-bullet-track">
        {!noPlan && (
          <motion.span
            data-testid="achievement-bar"
            className="dt-bullet-fill"
            style={{ background: color, width: `${width}%`, transformOrigin: 'left center' }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, delay: 0.1 + index * 0.06, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <span
          data-testid="target-marker"
          className="dt-bullet-target"
          style={{ left: `${marker}%` }}
          aria-hidden="true"
        />
      </span>
      <span className="dt-bullet-pct tnum" style={{ color: noPlan ? 'var(--text-dim)' : color }}>
        {noPlan ? 'no plan' : achievement(percent)}
      </span>
      <span className="dt-bullet-detail tnum">{detail}</span>
    </div>
  )
}
