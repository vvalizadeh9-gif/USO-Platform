import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BarChart3, Table2 } from 'lucide-react'
import { useState } from 'react'
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
 * The tabs are real ARIA tabs. They were plain buttons with a class, which
 * meant a screen reader announced four unlabelled buttons and gave no hint
 * that picking one changed the panel below.
 *
 * THE TABS RENDER IN THE CARD HEADER, beside the title and the total, rather
 * than in a control row above the panel. They are the card's question asked
 * three ways, so they belong on the line that asks it; a row of their own
 * read as furniture a reader had to get past before reaching the figures.
 * That is why `BreakdownTabs` is a separate export: `Section` renders it into
 * the header through its `controls` slot while this component renders the
 * panel it drives.
 *
 * A SEGMENTED CONTROL, not underline tabs. Three underline tabs beside a
 * title and a total were wider than a half-width card, so the Problematic
 * card's tabs wrapped to a second line and the two cards of the pair stood at
 * different heights. The segmented control is the same three choices in
 * about two thirds of the width, and the same control the trend card uses.
 * Still real ARIA tabs: what they switch is a panel.
 *
 * WHICH IS ALSO WHY `idBase` IS A PROP rather than a `useId`. The tablist and
 * the tabpanel it controls now live in two different components, and
 * `aria-controls`/`aria-labelledby` have to agree across that gap. A
 * generated id would be two different ids. The caller passes one stable
 * string and both sides derive from it, so the relationship a screen reader
 * depends on cannot come apart.
 */
export function BreakdownTabs({ idBase, tabs, tab, onTab }) {
  return (
    <div className="dt-seg" role="tablist" aria-label="Break down by">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.key}`}
          aria-selected={tab === t.key}
          aria-controls={`${idBase}-panel`}
          className={tab === t.key ? 'is-on' : undefined}
          onClick={() => onTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function BreakdownCard({ idBase, tab, views, total }) {
  const [asTable, setAsTable] = useState(false)
  const reduced = useReducedMotion()
  const view = views[tab]

  return (
    <>
      <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-tab-${tab}`}>
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
          </motion.div>
        </AnimatePresence>

        {/* The view's note and the chart/table switch share the card's foot.
            The switch used to take a row of its own above the bars -- a row
            of chrome over what is often two or three bars -- and the table
            is the second view, for checking the total, not the first. */}
        <div className="dt-breakdown-foot">
          {view.note ? <p className="dt-note">{view.note}</p> : <span />}
          <div className="dt-seg dt-seg-sm" role="group" aria-label="Chart or table">
            <button
              type="button"
              className={asTable ? undefined : 'is-on'}
              aria-pressed={!asTable}
              onClick={() => setAsTable(false)}
            >
              <BarChart3 size={12} aria-hidden="true" /> Chart
            </button>
            <button
              type="button"
              className={asTable ? 'is-on' : undefined}
              aria-pressed={asTable}
              onClick={() => setAsTable(true)}
            >
              <Table2 size={12} aria-hidden="true" /> Table
            </button>
          </div>
        </div>
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
      <table className="dt-mini-table">
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
