import { motion, useReducedMotion } from 'framer-motion'
import { achievement, bandColor, count } from '../format'

/**
 * One contractor's month: what they committed, and what they delivered.
 *
 * WHAT CHANGED AND WHY. This was a percentage bar — a single fill whose length
 * was `achievement_percent` against a 120% scale, with the counts ("44 of 48")
 * as text in a column beside it. Two things were wrong with that. The bar
 * encoded the *ratio* only, so a contractor who committed to 48 and one who
 * committed to 4 drew identical bars at the same rate, and the figures that
 * distinguish them sat outside the chart as text nobody compares by eye. And
 * because every row shared one 100%-wide track stretched across the page, the
 * marks read as progress indicators rather than as data.
 *
 * It is now a bullet chart on a shared *count* scale, which is the canonical
 * form for plan-against-actual and encodes both facts at once:
 *
 *   - the ghost bar is the plan (PIP), so its length is the size of the
 *     commitment and rows are comparable to each other;
 *   - the solid bar is what was delivered, coloured by band;
 *   - the cap at the ghost's end is the target, which is where it has always
 *     been — and it now sits at a place the reader can see, because a bar
 *     that overshoots visibly passes it.
 *
 * A contractor with no approved plan has no ghost and no target: there is
 * nothing to have delivered a share of. Their work still draws, in a neutral
 * colour, because it happened.
 */
export default function BulletBar({
  label,
  percent,
  pip = 0,
  actual = 0,
  detail,
  scaleMax,
  anonymous,
  index = 0,
}) {
  const reduced = useReducedMotion()
  const noPlan = percent == null
  const color = anonymous ? 'var(--text-dim)' : bandColor(percent)

  const pct = (v) => (scaleMax ? Math.min(100, (v / scaleMax) * 100) : 0)
  const planWidth = pct(pip)
  const doneWidth = pct(actual)

  return (
    <div className={`dt-bullet${anonymous ? ' dt-anon' : ''}${noPlan ? ' dt-noplan' : ''}`}>
      <span className="dt-bullet-label dt-farsi" title={label}>
        {label}
      </span>

      <span className="dt-bullet-track">
        {pip > 0 && (
          <motion.span
            className="dt-bullet-plan"
            style={{ width: `${planWidth}%`, transformOrigin: 'left center' }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, delay: 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <motion.span
          data-testid="achievement-bar"
          className="dt-bullet-fill"
          style={{ background: color, width: `${doneWidth}%`, transformOrigin: 'left center' }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.12 + 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
        />
        {pip > 0 && (
          <span
            data-testid="target-marker"
            className="dt-bullet-target"
            style={{ left: `${planWidth}%` }}
            aria-hidden="true"
          />
        )}
      </span>

      <span className="dt-bullet-detail tnum">{detail}</span>
      <span className="dt-bullet-pct tnum" style={{ color: noPlan ? 'var(--text-dim)' : color }}>
        {noPlan ? 'no plan' : achievement(percent)}
      </span>
    </div>
  )
}

/** The header key: what the ghost bar and the solid bar mean. */
export function BulletKey({ scaleMax }) {
  return (
    <span className="dt-bullet-key">
      <span className="dt-key-item">
        <i className="dt-key-plan" aria-hidden="true" />
        plan
      </span>
      <span className="dt-key-item">
        <i className="dt-key-done" aria-hidden="true" />
        delivered
      </span>
      <span className="dt-key-scale tnum">0–{count(scaleMax)} drive tests</span>
    </span>
  )
}
