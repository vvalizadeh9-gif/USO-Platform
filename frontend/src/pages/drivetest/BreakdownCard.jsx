import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BarChart3, Table2 } from 'lucide-react'
import { useId, useState } from 'react'
import { count, share } from './format'
import RankedBars from './charts/RankedBars'

/**
 * A total, split several ways, as bars or as a table.
 *
 * Tabs stay in component state rather than the URL. That is the same call the
 * old page made and it is still the right one: a tab is a way of looking at
 * one card, where the province filter changes every figure on the page — only
 * the second is a place worth linking to.
 *
 * The tabs are real ARIA tabs now. They were plain buttons with a class,
 * which meant a screen reader announced four unlabelled buttons and gave no
 * hint that picking one changed the panel below.
 */
export default function BreakdownCard({ tabs, tab, onTab, views, total }) {
  const [asTable, setAsTable] = useState(false)
  const reduced = useReducedMotion()
  const base = useId()
  const view = views[tab]

  return (
    <>
      <div className="dt-breakdown-controls">
        <div className="dt-tabs" role="tablist" aria-label="Break down by">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${base}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${base}-panel`}
              className={`dt-tab${tab === t.key ? ' dt-tab-active' : ''}`}
              onClick={() => onTab(t.key)}
            >
              {t.label}
              {tab === t.key && !reduced && (
                <motion.span className="dt-tab-underline" layoutId={`${base}-underline`} />
              )}
              {tab === t.key && reduced && <span className="dt-tab-underline" />}
            </button>
          ))}
        </div>

        <div className="dt-viewtoggle" role="group" aria-label="Chart or table">
          <button
            type="button"
            className={`btn btn-sm${asTable ? ' btn-ghost' : ''}`}
            aria-pressed={!asTable}
            onClick={() => setAsTable(false)}
          >
            <BarChart3 size={13} aria-hidden="true" /> Chart
          </button>
          <button
            type="button"
            className={`btn btn-sm${asTable ? '' : ' btn-ghost'}`}
            aria-pressed={asTable}
            onClick={() => setAsTable(true)}
          >
            <Table2 size={13} aria-hidden="true" /> Table
          </button>
        </div>
      </div>

      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${tab}-${asTable}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {asTable ? (
              <BreakdownTable points={view.points} total={total} unit={view.unit} />
            ) : (
              <RankedBars
                points={view.points}
                total={total}
                color={view.color}
                hrefFor={view.hrefFor}
              />
            )}
            {view.note && <p className="dt-note">{view.note}</p>}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

/**
 * The same points as a table, with the total spelled out at the foot.
 *
 * The total row is the point of the table view: it is where a reader checks
 * that what they are looking at accounts for the whole card, rather than
 * taking it on trust.
 */
function BreakdownTable({ points, total, unit }) {
  if (!points || points.length === 0) return <div className="dt-empty">No data yet</div>
  const shown = points.reduce((sum, p) => sum + p.value, 0)

  return (
    <div className="table-wrap scroll-x">
      <table>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col" style={{ textAlign: 'right' }}>Sites</th>
            <th scope="col" style={{ textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td className="dt-farsi" style={{ fontStyle: p.muted ? 'italic' : 'normal' }}>
                {p.name}
              </td>
              <td className="tnum" style={{ textAlign: 'right', fontWeight: 500 }}>
                {count(p.value)}
              </td>
              <td className="tnum dim" style={{ textAlign: 'right' }}>{share(p.value, total)}</td>
            </tr>
          ))}
          <tr className="dt-total-row">
            <th scope="row">Total</th>
            <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{count(shown)}</td>
            <td className="tnum dim" style={{ textAlign: 'right' }}>{share(shown, total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
