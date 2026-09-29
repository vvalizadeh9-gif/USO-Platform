import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import api from '../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../lib/download'
import { exportDescription, fmt } from '../pages/reports/lifecycleGaps'
import { Banner } from './ui'

/**
 * A village count that downloads the villages it counts.
 *
 * Every number on Lifecycle Gaps that counts villages is one of these, and
 * the rule behind it is that the file adds up to the number: the server lists
 * the same eligible villages, with the same gap condition and the same owner
 * attribution, as the figure it was drawn from (``GET /gaps/villages.xlsx``).
 * Percentages are never exportable -- only counts are.
 *
 * * `value` is the number shown; `count` the villages it stands for (the
 *   same, unless the caller shows a rounded or abbreviated figure).
 * * `gap` is the server's key for the figure; `lens` + `keyValue` narrow it
 *   to one owner; `scope` (`province:<fa>` / `region:<name>`) to one shape on
 *   the map, named `scopeLabel` in the button's label.
 *
 * At rest it is the number with a dotted underline; hover and focus give it
 * the accent-soft fill, a solid underline and a download icon, whose space is
 * always reserved so nothing moves. While the file is built it spins and is
 * disabled. The outcome is a banner in a fixed corner (see `ExportFeedback`),
 * so a download never scrolls or re-lays out the page.
 *
 * A zero is drawn as a plain number: an empty spreadsheet answers nothing.
 */
export default function ExportNumber({
  value,
  count = value,
  gap,
  lens,
  keyValue,
  scope,
  scopeLabel,
  className = '',
}) {
  const notify = useContext(FeedbackContext)
  const [busy, setBusy] = useState(false)

  if (!count) return <span className={`tnum ${className}`.trim()}>{fmt(value)}</span>

  const villages = `${fmt(count)} ${count === 1 ? 'village' : 'villages'}`
  const label = `Export ${villages} (${exportDescription({ gap, lens, keyValue, scopeLabel })}) to Excel`

  async function run(event) {
    // A figure can sit inside something clickable (a tile, a map panel row):
    // exporting is all this click does.
    event.stopPropagation()
    setBusy(true)
    try {
      const params = { gap }
      if (lens && keyValue) Object.assign(params, { lens, key: keyValue })
      if (scope) params.scope = scope
      const res = await api.get('/gaps/villages.xlsx', { params, responseType: 'blob' })
      saveBlob(res.data, filenameFrom(res.headers, `uep-${gap.replace(/_/g, '-')}.xlsx`))
      notify?.('success', `Exported ${villages}`)
    } catch (err) {
      notify?.('error', await describeBlobError(err, 'Could not export these villages.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`export-number ${className}`.trim()}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={run}
    >
      <span className="tnum">{fmt(value)}</span>
      <span className="export-number-icon" aria-hidden="true">
        {busy ? <span className="spinner" data-testid="export-spinner" /> : <Download size={14} />}
      </span>
    </button>
  )
}

const FeedbackContext = createContext(null)

/** How long a result banner stays up. */
const SHOW_MS = 5000

/**
 * Where `ExportNumber` reports how an export went: Cobalt banners stacked in
 * a fixed corner, outside the page's layout, so a result never pushes
 * anything. Wrap a page (or a test) in it once. Without it, exports still
 * work; they just say nothing.
 */
export function ExportFeedback({ children }) {
  const [notes, setNotes] = useState([])
  const timers = useRef(new Set())
  const seq = useRef(0)

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const notify = useCallback((tone, text) => {
    seq.current += 1
    const id = seq.current
    // Three at most: a fourth export replaces the oldest result.
    setNotes((current) => [...current.slice(-2), { id, tone, text }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setNotes((current) => current.filter((note) => note.id !== id))
    }, SHOW_MS)
    timers.current.add(timer)
  }, [])

  return (
    <FeedbackContext.Provider value={notify}>
      {children}
      {createPortal(
        <div className="export-feedback" aria-live="polite">
          {notes.map((note) => (
            <Banner key={note.id} tone={note.tone}>
              {note.text}
            </Banner>
          ))}
        </div>,
        document.body
      )}
    </FeedbackContext.Provider>
  )
}
