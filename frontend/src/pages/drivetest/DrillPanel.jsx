import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Download, ExternalLink, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { useToast } from '../../context/ToastContext'
import { BUCKET_LABEL } from './constants'
import { count } from './format'

/**
 * The sites behind the figure that was just clicked, without leaving the page.
 *
 * WHAT THIS IS FOR. Every figure on this dashboard already linked to
 * `/drive-test/sites` — that was the feature the old dashboard could not do
 * at all. But following one costs the reader the page: the scope chip, the
 * scroll position, the card they were comparing against. A reader checking
 * four contractors against each other made that round trip four times. The
 * panel answers the same question in place, and the full page is still one
 * click away inside it.
 *
 * THE HREF IS NOT REPLACED, IT IS INTERCEPTED. Every figure stays a real
 * `<Link>` to the real URL. A plain left click opens the panel instead of
 * navigating; a middle click, a modified click or a right-click "open in new
 * tab" all do exactly what they did before, because the `href` is still
 * there and still correct. That is also what keeps the drill-through URL
 * tests meaningful: they assert the address a figure points at, and the
 * panel is built by reading that same address back.
 *
 * THE COUNT IS THE SERVER'S, NEVER THIS COMPONENT'S. The panel does not
 * count rows and does not paginate its way to a total — it shows
 * `total`, which the endpoint computes before pagination through the
 * dashboard's own predicates. That is the whole reason the count in the
 * panel can be trusted to equal the figure that opened it. A panel that
 * counted its own rows would silently report the page size.
 *
 * SCOPE IS THE ENDPOINT'S. Nothing here widens anything: the panel sends the
 * query string the link already carried, and `apply_work_item_scope` decides
 * which sites exist for the caller before any filter in it is applied. A
 * `province_id` can only ever narrow what the caller could already see (see
 * `DriveTestAnalytics._load`, where the province `WHERE` is applied *after*
 * the scope), and a contractor account is forced to its own company whatever
 * the URL says (`dt_site_list._resolve_contractor`).
 */

const DrillContext = createContext(null)

/** How many rows the panel shows.
 *
 * Fewer than the full page's hundred, and deliberately not a paginator: the
 * panel exists to answer "what is behind this number", which the count and
 * the first screenful of rows do. A reader who needs the whole list needs
 * the sorting, filtering and column set the full page has, and the panel
 * hands them straight to it.
 */
const PANEL_ROWS = 25

/** The query string a drill-through link carries, as request params.
 *
 * Read back off the href rather than rebuilt from the figure that was
 * clicked. `links.js` is the one place that knows how these URLs are
 * spelled, and a panel that built its own params would be a second spelling
 * of the same filters — which is exactly the drift that module exists to
 * prevent.
 */
function paramsFromHref(href) {
  const query = String(href).split('?')[1] ?? ''
  return Object.fromEntries(new URLSearchParams(query))
}

export function DrillProvider({ children }) {
  const [focus, setFocus] = useState(null)

  const open = useCallback((href, label) => setFocus({ href, label }), [])
  const close = useCallback(() => setFocus(null), [])

  const value = useMemo(() => ({ open, close, focus }), [open, close, focus])

  return (
    <DrillContext.Provider value={value}>
      {children}
      <DrillPanel focus={focus} onClose={close} />
    </DrillContext.Provider>
  )
}

/** A figure's link, which opens the panel instead of navigating.
 *
 * Outside a `DrillProvider` it is an ordinary `Link`, so nothing that uses
 * these components in isolation has to know the panel exists.
 */
export function DrillLink({ to, drillLabel, onClick, children, ...rest }) {
  const ctx = useContext(DrillContext)

  const handle = (e) => {
    // The caller's handler runs first and keeps its say: the province cards
    // pass one that stops the click reaching the card's own scope handler
    // underneath, and that has to happen whether or not the panel opens.
    onClick?.(e)
    if (!ctx || e.defaultPrevented) return
    // Anything but a plain left click is a request to open the URL properly
    // — a new tab, a new window — and the href is still the right one.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    ctx.open(to, drillLabel)
  }

  return (
    <Link to={to} onClick={handle} {...rest}>
      {children}
    </Link>
  )
}

function DrillPanel({ focus, onClose }) {
  const reduced = useReducedMotion()
  const toast = useToast()
  const closeRef = useRef(null)
  const [state, setState] = useState({ data: null, error: null, loading: false })
  const [exporting, setExporting] = useState(false)

  const href = focus?.href
  const params = useMemo(() => (href ? paramsFromHref(href) : null), [href])

  useEffect(() => {
    if (!params) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    let live = true
    setState({ data: null, error: null, loading: true })
    api
      .get('/drive-test/sites', { params: { ...params, limit: PANEL_ROWS } })
      .then((r) => {
        if (live) setState({ data: r.data, error: null, loading: false })
      })
      .catch((err) => {
        if (live) {
          setState({
            data: null,
            // The reason the server gave. A 422 here means a filter the
            // endpoint refused, and saying which one is the difference
            // between a bug report and "it didn't work".
            error: err.response?.data?.detail || 'Could not load these sites.',
            loading: false,
          })
        }
      })
    return () => {
      live = false
    }
  }, [params])

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
      // The same endpoint the full page uses, with the same params. Not a
      // second export path and not a file built here: the server's export is
      // the one that knows the column set, the row cap and the scope, and a
      // spreadsheet assembled in the browser from twenty-five loaded rows
      // would be a different, silently shorter answer.
      const res = await api.get('/drive-test/sites/export', {
        params,
        responseType: 'blob',
      })
      saveBlob(res.data, filenameFrom(res.headers, `drive-test-${params.bucket || 'onair'}.xlsx`))
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  const data = state.data
  const total = data?.total
  const rows = data?.rows ?? []
  const bucket = params?.bucket || 'onair'
  const noun = BUCKET_LABEL[bucket] || 'sites'

  return (
    <AnimatePresence>
      {focus && (
        <motion.aside
          className="dt-drill"
          role="dialog"
          aria-label={`Sites behind this figure: ${noun}`}
          data-testid="dt-drill"
          initial={reduced ? false : { x: '100%' }}
          animate={{ x: 0 }}
          exit={reduced ? undefined : { x: '100%' }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <header className="dt-drill-head">
            <div className="dt-drill-title">
              {/* What was clicked, named back in the words the dashboard
                  used — see BUCKET_LABEL. A reader arriving from a number
                  should recognise it, not be shown "bucket: problematic". */}
              <span className="dt-drill-count tnum">
                {state.loading ? '…' : count(total)}
              </span>
              <span className="dt-drill-noun">{noun}</span>
              {focus.label && <span className="dt-drill-scope dt-farsi">{focus.label}</span>}
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
                  <div key={i} className="dt-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="dt-empty">No sites match this figure.</div>
            ) : (
              <table className="dt-drill-table">
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Province</th>
                    <th scope="col">Contractor</th>
                    <th scope="col">State</th>
                    <th scope="col">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.work_item_id}>
                      <td className="tnum">{row.site_code || '—'}</td>
                      <td className="dt-farsi">{row.province || '—'}</td>
                      <td className="dt-farsi">{row.contractor || '—'}</td>
                      <td>{row.bucket}</td>
                      {/* The band on whichever clock applies to this row:
                          ongoing sites age from assignment, problematic ones
                          from the day they last became problematic. A site on
                          neither clock gets a dash rather than a number in a
                          unit the column does not otherwise carry. */}
                      <td>{row.age_band || row.problem_age_band || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {total > rows.length && (
              <p className="dt-note">
                Showing the first {count(rows.length)} of {count(total)}. The full list has the
                sorting, filtering and every column.
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
              {exporting ? 'Building…' : 'Export this list (XLSX)'}
            </button>
            <Link to={href} className="btn btn-sm btn-ghost" onClick={onClose}>
              <ExternalLink size={13} aria-hidden="true" />
              Open in site list
            </Link>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
