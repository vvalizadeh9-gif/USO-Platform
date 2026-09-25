import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Download, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { fmtCount } from './kpiTheme'

/**
 * The sites behind the Acceptance figure that was just clicked.
 *
 * WHAT THIS IS FOR. Every quantity on the dashboard is a village count, and a
 * village count is not something a person can act on: they act on site ids —
 * what they look up, what they put in a mail to a contractor, what the drive
 * test and health check screens are keyed by. This panel is the bridge. It
 * opens beside the card rather than replacing the page, because the whole
 * point is reading the list against the figure that produced it.
 *
 * It is deliberately the same object as the Drive Test dashboard's drill
 * panel (`drivetest/DrillPanel.jsx`) — same right-hand sheet, same `.dt-drill-*`
 * shell, same export button in the footer — because a reader who has learned
 * that a number on one dashboard opens its list should not have to learn it
 * twice. What differs is only what is behind it: this one reads
 * `/acceptance/sites`, whose rows are sites and whose `total` is villages.
 *
 * THE COUNT IS THE SERVER'S, NEVER THIS COMPONENT'S. `total` is computed by
 * the same analytics that produced the figure, over the same universe, before
 * any pagination — see `AcceptanceAnalytics.site_rows`. That is what lets the
 * number in the panel be trusted to equal the number that opened it. This
 * component never counts rows and never sums a column.
 *
 * A FIGURE OUTSIDE A PROVIDER STILL RENDERS. `DrillFigure` falls back to a
 * plain span when no provider is above it, so a card can be rendered in
 * isolation — in a test, in a story — without knowing the panel exists.
 */

/** How many sites the panel lists.
 *
 * Enough that most figures are answered in the panel itself, and not a
 * paginator: a reader who needs more than this needs the spreadsheet, which
 * the footer hands them in one click and which is never truncated.
 */
const PANEL_ROWS = 50

const DrillContext = createContext(null)

export function AcceptanceDrillProvider({ children }) {
  const [focus, setFocus] = useState(null)

  const open = useCallback((metric, label) => setFocus({ metric, label }), [])
  const close = useCallback(() => setFocus(null), [])
  const value = useMemo(() => ({ open, close, focus }), [open, close, focus])

  return (
    <DrillContext.Provider value={value}>
      {children}
      <AcceptanceDrillPanel focus={focus} onClose={close} />
    </DrillContext.Provider>
  )
}

/**
 * A quantity that opens the sites behind it.
 *
 * `metric` is the server's name for the figure — one of the keys in
 * `acceptance_analytics.SITE_METRICS` — and it is the only thing that decides
 * what the panel lists. `label` is what the card called the number, repeated
 * in the panel's header so a reader arriving from a figure recognises it.
 */
export function DrillFigure({ metric, label, value, className, children }) {
  const ctx = useContext(DrillContext)
  const shown = children ?? fmtCount(value)

  if (!ctx) return <span className={className}>{shown}</span>

  return (
    <button
      type="button"
      className={`drill ${className || ''}`.trim()}
      onClick={() => ctx.open(metric, label)}
      aria-label={`${label}: ${value} villages — open the sites behind this figure`}
    >
      {shown}
    </button>
  )
}

function AcceptanceDrillPanel({ focus, onClose }) {
  const reduced = useReducedMotion()
  const toast = useToast()
  const closeRef = useRef(null)
  const [state, setState] = useState({ data: null, error: null, loading: false })
  const [exporting, setExporting] = useState(false)

  const metric = focus?.metric

  useEffect(() => {
    if (!metric) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    let live = true
    setState({ data: null, error: null, loading: true })
    api
      .get('/acceptance/sites', { params: { metric, limit: PANEL_ROWS } })
      .then((r) => {
        if (live) setState({ data: r.data, error: null, loading: false })
      })
      .catch((err) => {
        if (live) {
          setState({
            data: null,
            // The reason the server gave. A 422 here names the metric it
            // refused, which is the difference between a bug report and
            // "it didn't work".
            error: err.response?.data?.detail || 'Could not load these sites.',
            loading: false,
          })
        }
      })
    return () => {
      live = false
    }
  }, [metric])

  // Escape closes, the same as the button. A panel that can only be dismissed
  // by finding a small target is one people leave open and scroll behind.
  useEffect(() => {
    if (!focus) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, onClose])

  useEffect(() => {
    if (focus) closeRef.current?.focus()
  }, [focus])

  async function exportList() {
    setExporting(true)
    try {
      // The server's export, with the same metric. Not a file built here: a
      // spreadsheet assembled in the browser from the fifty loaded rows would
      // be a different, silently shorter answer than the figure promised.
      const res = await api.get('/acceptance/sites/export', {
        params: { metric },
        responseType: 'blob',
      })
      saveBlob(res.data, filenameFrom(res.headers, `acceptance-${metric}.xlsx`))
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  const data = state.data
  const rows = data?.rows ?? []
  const total = data?.total
  const siteCount = data?.site_count ?? 0

  return (
    <AnimatePresence>
      {focus && (
        <motion.aside
          className="dt-drill"
          role="dialog"
          aria-label={`Sites behind this figure: ${focus.label}`}
          data-testid="acc-drill"
          initial={reduced ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={reduced ? undefined : { x: '100%' }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <header className="dt-drill-head">
            <div className="dt-drill-title">
              {/* The village count leads, because that is the number that was
                  clicked; the site count follows it, because that is what the
                  rows below are. Saying only one of the two invites the
                  reader to assume the table is short. */}
              <span className="dt-drill-count tnum">
                {state.loading ? '…' : fmtCount(total)}
              </span>
              <span className="dt-drill-noun">{focus.label}</span>
              {!state.loading && !state.error && (
                <span className="dt-drill-scope">
                  on {fmtCount(siteCount)} site{siteCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <button
              ref={closeRef}
              type="button"
              className="btn btn-sm btn-ghost dt-drill-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>

          <div className="dt-drill-body">
            {state.error ? (
              <div className="dt-failed" role="alert">
                <span>{state.error}</span>
              </div>
            ) : state.loading ? (
              <div className="dt-skeleton" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className="dt-skeleton-row"
                    style={{ animationDelay: `${i * 0.06}s` }}
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="dt-empty">No sites match this figure.</div>
            ) : (
              <table className="dt-drill-table">
                <thead>
                  <tr>
                    <th scope="col">Site ID</th>
                    <th scope="col">Province</th>
                    <th scope="col">Villages</th>
                    <th scope="col">Approved</th>
                    <th scope="col">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.site_id}-${row.site_code}`}>
                      <td className="tnum">{row.site_code || '—'}</td>
                      <td className="dt-farsi">{row.province || '—'}</td>
                      <td className="tnum">{row.villages}</td>
                      <td className="tnum">{row.approved}</td>
                      <td className="tnum">{row.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {siteCount > rows.length && (
              <p className="dt-note">
                Showing the first {fmtCount(rows.length)} of {fmtCount(siteCount)} sites.
                The export holds all of them.
              </p>
            )}
          </div>

          <footer className="dt-drill-foot">
            <button
              type="button"
              className="btn btn-sm"
              onClick={exportList}
              disabled={exporting || !!state.error}
            >
              <Download size={13} aria-hidden="true" />
              {exporting ? 'Building…' : 'Export site list (XLSX)'}
            </button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
