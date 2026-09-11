import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { count, share } from '../format'
import { queueLink } from '../links'

/**
 * Where the ongoing sites are actually stuck.
 *
 * The endpoint has always sent `by_stage` and the old dashboard deliberately
 * threw it away, on the reasoning that a pipeline belongs in the work queues.
 * The reasoning was half right: the queues are where you *act* on a stage.
 * But "whose are these ongoing sites" and "why have they not moved" are
 * different questions, and the old page could only answer the first. A site
 * sitting in Ready for Assignment is waiting on us; one in Assigned is
 * waiting on a contractor; one in DT Submitted is waiting on a reviewer. That
 * distinction decides who gets chased, and it was being computed, sent over
 * the wire, and discarded.
 *
 * Drawn in workflow order, never sorted by size, with empty stages kept.
 * Both rules come from the backend's own `_stage_points`, and both matter for
 * the same reason: this is a sequence, and a row of buckets that reorders
 * itself between readings means something different every time.
 */
export default function StagePipeline({ points, total, provinceId }) {
  const reduced = useReducedMotion()
  if (!points || points.length === 0) {
    return <div className="dt-empty">No ongoing sites.</div>
  }

  const widest = Math.max(1, ...points.map((p) => p.value))

  return (
    <ol className="dt-pipeline">
      {points.map((p, i) => {
        const pct = (p.value / widest) * 100
        const empty = p.value === 0
        return (
          <li key={p.name} className={`dt-pipe-step${empty ? ' dt-pipe-empty' : ''}`}>
            <span className="dt-pipe-rail" aria-hidden="true">
              <span className="dt-pipe-dot" />
              {i < points.length - 1 && <span className="dt-pipe-line" />}
            </span>
            <Link
              to={queueLink({ stage: p.name, provinceId })}
              className="dt-pipe-body"
              aria-label={`${p.name}: ${p.value} ongoing sites`}
            >
              <span className="dt-pipe-name">{p.name}</span>
              <span className="dt-pipe-bar" aria-hidden="true">
                <motion.span
                  data-testid="dt-bar"
                  style={{ width: `${pct}%`, transformOrigin: 'left center' }}
                  initial={reduced ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.5, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
              <span className="dt-pipe-value tnum">{count(p.value)}</span>
              <span className="dt-pipe-share tnum">{share(p.value, total)}</span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
