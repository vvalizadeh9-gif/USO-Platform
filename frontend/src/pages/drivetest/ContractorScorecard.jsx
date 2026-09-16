import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { STATE_COLOR } from './constants'
import { bookScale, count, percent, progressColor } from './format'
import { doneLink, ongoingLink, problematicLink } from './links'
import BookBar from './charts/BookBar'

/**
 * Each contractor's assignment, and how much of it is finished.
 *
 * WHAT "ASSIGNMENT" MEANS HERE, because it is the whole basis of the ranking:
 * the drive tests a company has completed, plus the sites it is still
 * holding. Nothing else. It is deliberately not every on-air site that
 * carries the company's name — a site sitting in a problem category, or one
 * sent out for a health check, has not been committed to them, and dividing
 * by it would mark a company down for work the programme never handed over.
 * Problematic sites keep a column, because they are worth seeing; they are
 * simply not part of the book being scored. The backend computes it the same
 * way — see `_contractor_scorecard`.
 *
 * WHAT CHANGED IN THE CHART. The rate used to be a fixed-width track with a
 * fill, one per row. Every row was therefore the same width, so a company at
 * 62% of twelve sites drew the identical bar to one at 62% of four hundred,
 * and the column ranked two situations that call for opposite decisions as
 * though they were the same. The bar is now sized to the book as well as
 * filled by it — see `charts/BookBar`.
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
  const scale = bookScale(rows.map((r) => r.assigned))

  return (
    <>
      <div className="dt-key" aria-hidden="true">
        <span className="dt-key-item">
          <i style={{ background: STATE_COLOR.done }} />
          DT done
        </span>
        <span className="dt-key-item">
          <i style={{ background: STATE_COLOR.ongoing }} />
          Ongoing
        </span>
        <span className="dt-key-note">bar length is the size of the assignment</span>
      </div>

      <div className="table-wrap scroll-x">
        <table className="dt-scorecard">
          <thead>
            <tr>
              <th scope="col">Contractor</th>
              <th scope="col" style={{ textAlign: 'right' }}>Assignment</th>
              <th scope="col" style={{ textAlign: 'right' }}>DT done</th>
              <th scope="col" style={{ textAlign: 'right' }}>Ongoing</th>
              <th scope="col" style={{ textAlign: 'right' }}>Problematic</th>
              <th scope="col" style={{ textAlign: 'right' }}>Done</th>
              <th scope="col" className="dt-col-book">Where the work is</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const unattributed = row.contractor_id == null
              const cscope = unattributed ? null : { ...scope, contractorId: row.contractor_id }
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
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {count(row.assigned)}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {cscope ? (
                      <Link to={doneLink(cscope)} className="dt-cell-link">
                        {count(row.done)}
                      </Link>
                    ) : (
                      count(row.done)
                    )}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {cscope ? (
                      <Link to={ongoingLink(cscope)} className="dt-cell-link">
                        {count(row.ongoing)}
                      </Link>
                    ) : (
                      count(row.ongoing)
                    )}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {cscope && row.problematic > 0 ? (
                      <Link
                        to={problematicLink(cscope)}
                        className="dt-cell-link dt-cell-link-bad"
                      >
                        {count(row.problematic)}
                      </Link>
                    ) : (
                      count(row.problematic)
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      className="dt-rate"
                      style={{
                        color: unattributed ? 'var(--text-dim)' : progressColor(row.done_percent),
                      }}
                    >
                      {percent(row.done_percent)}
                    </span>
                  </td>
                  <td className="dt-col-book">
                    <BookBar
                      label={row.name}
                      total={row.assigned}
                      scaleMax={scale}
                      index={i}
                      segments={[
                        {
                          key: 'done',
                          label: 'DT done',
                          value: row.done,
                          color: unattributed ? 'var(--text-dim)' : STATE_COLOR.done,
                        },
                        {
                          key: 'ongoing',
                          label: 'Ongoing',
                          value: row.ongoing,
                          color: unattributed ? 'var(--border)' : STATE_COLOR.ongoing,
                        },
                      ]}
                    />
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
