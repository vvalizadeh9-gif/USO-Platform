import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { formatNumber } from '../lib/numbers'
import { buildGroups, fallbackRoute, flattenRows, isSearchable, normaliseQuery, stepIndex } from './globalSearch'

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

/** The pause after the last key before the server is asked. */
export const SEARCH_DELAY_MS = 250

/**
 * The header search: one box for the interface and the data behind it.
 *
 * Typing lists matching pages and apps at once (they are in the browser) and,
 * a moment later, the sites, villages, contractors and people the server finds
 * -- only what the signed-in person could already open. Arrow keys walk the
 * list, Enter opens the highlighted row (or the first, or the full site search
 * when nothing matches), Esc closes. It is a combobox: the input keeps focus
 * and names the highlighted row, so a screen reader follows along.
 */
export default function GlobalSearch({ apps }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const listId = useId()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [found, setFound] = useState({ term: '', groups: [] })
  const [failed, setFailed] = useState(false)

  const query = normaliseQuery(term)
  const searchable = isSearchable(query)
  // What the server has said about *this* text. A slower answer to an earlier
  // keystroke is never shown against a later one.
  const settled = found.term === query
  const loading = searchable && !settled && !failed
  const groups = useMemo(
    () => buildGroups(apps, query, settled ? found.groups : []),
    [apps, query, settled, found.groups],
  )
  const rows = useMemo(() => flattenRows(groups), [groups])

  // Ctrl/⌘ K from anywhere puts the cursor here.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Ask the server once typing pauses, and drop the request if it goes on.
  useEffect(() => {
    if (!searchable) return undefined
    setFailed(false)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .get('/search', { params: { q: query }, signal: controller.signal })
        .then((r) => setFound({ term: query, groups: r.data.groups || [] }))
        .catch((e) => {
          if (!controller.signal.aborted && e?.code !== 'ERR_CANCELED') setFailed(true)
        })
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, searchable])

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // The highlight belongs to one list; a new list starts with none.
  useEffect(() => setActive(-1), [query, settled])

  const go = ({ route, state }) => {
    navigate(route, state ? { state } : undefined)
    setTerm('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => stepIndex(i, rows.length, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Escape') {
      if (open || term) {
        e.preventDefault()
        setOpen(false)
        setTerm('')
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!searchable) return
      if (active >= 0 && rows[active]) go(rows[active])
      else go(fallbackRoute(rows, query))
    }
  }

  const showList = open && searchable
  const optionId = (id) => `${listId}-${id.replace(/[^\w-]/g, '_')}`
  let rowIndex = -1
  const statusText = !showList
    ? ''
    : loading
      ? 'Searching…'
      : failed
        ? 'Search is unavailable.'
        : rows.length === 0
          ? 'No results.'
          : `${formatNumber(groups.reduce((n, g) => n + g.total, 0))} results.`

  return (
    <div className="uep-search-wrap" ref={boxRef}>
      <div className="uep-search" role="search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search sites, villages, contractors, pages…"
          aria-label="Search sites, villages, contractors, people and pages"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 && rows[active] ? optionId(rows[active].id) : undefined}
        />
        <kbd aria-hidden="true">{SHORTCUT}</kbd>
      </div>

      <span className="sr-only" role="status" aria-live="polite">{statusText}</span>

      {showList && (
        <div className="uep-search-pop" id={listId} role="listbox" aria-label="Search results">
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label} className="uep-search-group">
              <div className="uep-search-label" aria-hidden="true">
                {g.label}
                {g.total > g.items.length && <span>{formatNumber(g.total)}</span>}
              </div>
              {g.items.map((item) => {
                rowIndex += 1
                const mine = rowIndex
                return (
                  <button
                    key={item.id}
                    id={optionId(item.id)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={active === mine}
                    className="uep-search-row"
                    onMouseEnter={() => setActive(mine)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(item)}
                  >
                    <b>{item.title}</b>
                    {item.subtitle && <span>{item.subtitle}</span>}
                  </button>
                )
              })}
              {g.seeAll && (() => {
                rowIndex += 1
                const mine = rowIndex
                return (
                  <button
                    id={optionId(`${g.key}:all`)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={active === mine}
                    className="uep-search-row uep-search-all"
                    onMouseEnter={() => setActive(mine)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go({ route: g.seeAll })}
                  >
                    See all {formatNumber(g.total)} {g.label.toLowerCase()}
                  </button>
                )
              })()}
            </div>
          ))}

          {loading && <div className="uep-search-note">Searching…</div>}
          {failed && <div className="uep-search-note" role="alert">Search is unavailable right now. Pages above still work.</div>}
          {!loading && !failed && groups.length === 0 && (
            <div className="uep-search-note">
              No results for “{query}”. Press Enter to search all sites.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
