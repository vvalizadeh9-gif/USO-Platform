import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { count, percent, progressColor } from './format'
import { ongoingLink, problematicLink } from './links'

/**
 * Each contractor's whole book of work, ranked by how far through it they are.
 *
 * This replaces two charts that were measuring the wrong thing. "Drive tests
 * done per contractor (all time)" ranked companies by how long they had been
 * on the programme — a company at 521 all-time might be delivering four a
 * month now — and ongoing-per-contractor ranked them by size, because a firm
 * holding four hundred sites will show more ongoing work than one holding a
 * hundred whatever either of them is doing. Neither was a performance
 * ranking, and both read like one.
 *
 * Carrying the denominator fixes that: `done_percent` is how far through its
 * own book each company is, which is comparable across companies of any size.
 * The raw counts stay on the row, because "62% of 400" and "62% of 12" are
 * the same rate and very different situations.
 *
 * The unattributed row sits last and is styled apart. It is not a company and
 * cannot be beaten or beat anyone; the backend sorts it out of the ranking
 * for the same reason.
 */
export default function ContractorScorecard({ rows, provinceId }) {
  const reduced = useReducedMotion()
  if (!rows || rows.length === 0) {
    return <div className="dt-empty">No contractor work to show.</div>
  }

  const scope = provinceId == null ? {} : { provinceId }

  return (
    <div className="table-wrap scroll-x">
      <table className="dt-scorecard">
        <thead>
          <tr>
            <th scope="col">Contractor</th>
            <th scope="col" style={{ textAlign: 'right' }}>On-air</th>
            <th scope="col" style={{ textAlign: 'right' }}>Done</th>
            <th scope="col" style={{ textAlign: 'right' }}>Ongoing</th>
            <th scope="col" style={{ textAlign: 'right' }}>Problematic</th>
            <th scope="col" className="dt-col-rate">Completion of own book</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const unattributed = row.contractor_id == null
            return (
              <motion.tr
                key={row.contractor_id ?? 'unattributed'}
                className={unattributed ? 'dt-unattributed' : undefined}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.25 }}
              >
                <td className="dt-farsi" style={{ fontWeight: unattributed ? 400 : 500 }}>
                  {row.name}
                </td>
                <td className="tnum" style={{ textAlign: 'right' }}>{count(row.onair)}</td>
                <td className="tnum dt-good" style={{ textAlign: 'right' }}>{count(row.done)}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>
                  {unattributed ? (
                    count(row.ongoing)
                  ) : (
                    <Link
                      to={ongoingLink({ ...scope, contractorId: row.contractor_id })}
                      className="dt-cell-link"
                    >
                      {count(row.ongoing)}
                    </Link>
                  )}
                </td>
                <td
                  className="tnum"
                  style={{ textAlign: 'right', color: row.problematic > 0 ? 'var(--red)' : undefined }}
                >
                  {!unattributed && row.problematic > 0 ? (
                    <Link
                      to={problematicLink({ ...scope, contractorId: row.contractor_id })}
                      className="dt-cell-link dt-cell-link-bad"
                    >
                      {count(row.problematic)}
                    </Link>
                  ) : (
                    count(row.problematic)
                  )}
                </td>
                <td>
                  <span className="dt-progress-cell dt-progress-wide">
                    <span className="dt-progress-track" aria-hidden="true">
                      <motion.span
                        data-testid="dt-bar"
                        style={{
                          width: `${row.done_percent}%`,
                          background: unattributed ? 'var(--text-dim)' : progressColor(row.done_percent),
                          transformOrigin: 'left center',
                        }}
                        initial={reduced ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.55, delay: 0.1 + Math.min(i * 0.05, 0.3) }}
                      />
                    </span>
                    <span className="tnum dt-progress-pct">{percent(row.done_percent)}</span>
                  </span>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
