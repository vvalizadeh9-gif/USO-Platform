import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { roleLabel } from '../lib/roles'
import { EXPLORER_PATH, explorerListPath, siteRecordPath } from '../lib/explorerLinks'
import { appState } from './appRegistry'
import SearchOption from './SearchOption'
import { GROUP_LOOK } from './searchLook'

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

/** Server results start at this many characters (GET /search refuses fewer). */
const MIN_QUERY = 2
const DEBOUNCE_MS = 200
const MAX_PAGES = 6
/** Rows past this many enter together with the tenth. */
const MAX_STAGGER = 10

const fold = (s) => (s || '').toLocaleLowerCase()

/** Every app and app page this role can open whose name contains `term`. */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function matchPages(apps, term) {
  const t = fold(term.trim())
  if (!t) return []
  const hits = []
  for (const app of apps) {
    const appHit = fold(app.name).includes(t) || fold(app.description).includes(t)
    for (const page of app.pages) {
      if (appHit || fold(page.label).includes(t)) {
        hits.push({
          key: `page:${app.id}:${page.id}`,
          label: page.label,
          meta: app.name,
          to: page.route,
          state: appState(app),
        })
      }
    }
  }
  return hits.slice(0, MAX_PAGES)
}

/** GET /search's groups as navigable options, in the order they are shown. */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function resultGroups(pages, data) {
  const groups = [{ id: 'pages', label: 'Apps and pages', items: pages }]
  if (data) {
    groups.push(
      {
        id: 'sites',
        label: 'Sites',
        items: data.sites.map((s) => ({
          key: `site:${s.id}`,
          label: s.site_code,
          meta: [s.province, s.stage],
          to: siteRecordPath(s.id),
        })),
      },
      {
        id: 'villages',
        label: 'Villages',
        items: data.villages.map((v, i) => ({
          key: `village:${v.work_item_id}:${v.village_code ?? i}`,
          label: v.village_name || v.village_code,
          meta: `Site ${v.site_code}`,
          to: siteRecordPath(v.work_item_id, v.village_code),
        })),
      },
      {
        id: 'provinces',
        label: 'Provinces',
        items: data.provinces.map((p) => ({
          key: `province:${p.id}`,
          label: p.name,
          meta: 'All sites in this province',
          to: explorerListPath({ province: p.id }),
        })),
      },
      {
        id: 'contractors',
        label: 'Contractors',
        items: data.contractors.map((c) => ({
          key: `contractor:${c.id}`,
          label: c.name,
          meta: 'All sites for this contractor',
          to: explorerListPath({ dt_contractor: c.id }),
        })),
      },
      {
        id: 'people',
        label: 'People',
        items: data.people.map((p) => ({
          key: `person:${p.id}`,
          label: p.full_name,
          meta: [p.username, roleLabel(p.role)],
          to: `/admin?tab=users&search=${encodeURIComponent(p.username)}`,
        })),
      },
    )
  }
  return groups.filter((g) => g.items.length > 0)
}

/**
 * Rows and group labels rise in when the panel opens or when a group first
 * appears (server results landing). Typing within groups already shown
 * re-renders them without replaying it. Returns a key's place in the
 * stagger, or null when that row does not animate.
 */
function useRise(groups, showing) {
  const seen = useRef(new Set())
  const rising = useRef(new Map())
  if (!showing) {
    seen.current.clear()
    rising.current.clear()
  } else {
    let n = 0
    for (const g of groups) {
      if (seen.current.has(g.id)) continue
      for (const key of [`group:${g.id}`, ...g.items.map((it) => it.key)]) {
        if (!rising.current.has(key)) rising.current.set(key, Math.min(n, MAX_STAGGER))
        n += 1
      }
    }
  }
  useEffect(() => {
    if (!showing) return
    const live = new Set()
    for (const g of groups) {
      seen.current.add(g.id)
      live.add(`group:${g.id}`)
      g.items.forEach((it) => live.add(it.key))
    }
    for (const key of rising.current.keys()) if (!live.has(key)) rising.current.delete(key)
  }, [groups, showing])
  return (key) => rising.current.get(key) ?? null
}

/**
 * The header search: apps and pages match as you type, and from two
 * characters on, sites, villages, provinces, contractors and (for an Admin)
 * people come from GET /search, each scoped to what this person can open.
 * The field widens while focused; the results panel enters and leaves (it
 * stays mounted, inert while hidden). Arrow keys move one shared highlight,
 * Enter opens the active result, Escape clears the text and then leaves.
 */
export default function GlobalSearch({ apps }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const hiRef = useRef(null)
  const hiOptions = useRef(null)
  const byKey = useRef(false)
  const lastView = useRef({ groups: [], term: '', message: null })
  const listId = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [remote, setRemote] = useState({ term: '', data: null, loading: false })

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const term = q.trim()
  useEffect(() => {
    if (term.length < MIN_QUERY) {
      setRemote({ term: '', data: null, loading: false })
      return undefined
    }
    setRemote((r) => ({ ...r, loading: true }))
    let live = true
    const t = setTimeout(() => {
      api
        .get('/search', { params: { q: term } })
        .then((r) => live && setRemote({ term, data: r.data, loading: false }))
        .catch(() => live && setRemote({ term, data: null, loading: false }))
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [term])

  const canListSites = apps.some((a) => a.pages.some((p) => p.route === EXPLORER_PATH))
  const groups = useMemo(() => {
    const found = resultGroups(matchPages(apps, term), remote.term === term ? remote.data : null)
    if (canListSites && term.length >= MIN_QUERY) {
      found.push({
        id: 'all',
        label: null,
        items: [{ key: 'all-sites', label: `Search all sites for “${term}”`, to: explorerListPath({ q: term }) }],
      })
    }
    return found
  }, [apps, term, remote, canListSites])
  const options = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => setActive(0), [term])

  const showing = open && term.length > 0
  const searching = showing && (remote.loading || (term.length >= MIN_QUERY && remote.term !== term))
  let message = null
  if (showing && !searching && options.length === 0) {
    message = term.length < MIN_QUERY ? 'Type one more character to search sites and villages.' : `Nothing matches “${term}”.`
  }
  // While the panel leaves it keeps showing what it last showed.
  if (showing) lastView.current = { groups, term, message }
  const view = lastView.current
  const riseOf = useRise(view.groups, showing)

  // One highlight behind the rows slides to the active one; it jumps when
  // the list itself changed.
  useLayoutEffect(() => {
    const hi = hiRef.current
    if (!hi) return
    if (!showing) {
      hiOptions.current = null
      return
    }
    const row = listRef.current?.querySelector('[role="option"][aria-selected="true"]')
    if (!row) {
      hi.style.opacity = '0'
      hiOptions.current = null
      return
    }
    const jump = hiOptions.current !== options
    hiOptions.current = options
    if (jump) hi.style.transition = 'none'
    hi.style.transform = `translateY(${row.offsetTop}px)`
    hi.style.height = `${row.offsetHeight}px`
    hi.style.opacity = '1'
    if (jump) {
      void hi.offsetHeight
      hi.style.transition = ''
    }
    if (byKey.current) {
      row.scrollIntoView?.({ block: 'nearest' })
      byKey.current = false
    }
  }, [active, options, showing])

  const close = () => {
    setOpen(false)
    setActive(0)
  }

  const go = (option) => {
    if (!option) return
    navigate(option.to, option.state ? { state: option.state } : undefined)
    setQ('')
    close()
    inputRef.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (q) {
        setQ('')
        setActive(0)
      } else {
        inputRef.current?.blur()
      }
      return
    }
    if (!options.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      byKey.current = true
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + options.length) % options.length)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    go(options[active] ?? options[0])
  }

  const optionId = (i) => `${listId}-opt-${i}`
  let index = -1

  return (
    <div className="uep-search-zone">
      <form
        className={`uep-search${open ? ' is-open' : ''}`}
        role="search"
        onSubmit={onSubmit}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) close()
        }}
      >
        <Icon name="search" size={16} className="uep-search-icon" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search sites, villages, provinces and pages"
          aria-label="Search sites, villages, provinces and pages"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={listId}
          aria-activedescendant={showing && options.length ? optionId(active) : undefined}
          autoComplete="off"
        />
        <span className="uep-search-kbd" aria-hidden="true">
          <kbd className="is-rest">{SHORTCUT}</kbd>
          <kbd className="is-esc">Esc</kbd>
        </span>
        <div
          className="uep-search-panel"
          data-state={showing ? 'showing' : 'hidden'}
          inert={showing ? undefined : ''}
          aria-hidden={showing ? undefined : 'true'}
        >
          <div className="uep-search-progress" data-active={searching} aria-hidden="true"><i /></div>
          <div ref={listRef} className="uep-search-results" id={listId} role="listbox" aria-label="Search results">
            <div ref={hiRef} className="uep-search-hi" aria-hidden="true" />
            {view.groups.map((g) => {
              const labelRise = riseOf(`group:${g.id}`)
              return (
                <div key={g.id} role="group" aria-label={g.label || undefined} className="uep-search-group">
                  {g.label && (
                    <div
                      className={`uep-search-group-label${labelRise != null ? ' is-rising' : ''}`}
                      style={labelRise != null ? { '--rise': labelRise } : undefined}
                      aria-hidden="true"
                    >
                      {g.label}
                    </div>
                  )}
                  {g.items.map((item) => {
                    index += 1
                    const i = index
                    return (
                      <SearchOption
                        key={item.key}
                        id={optionId(i)}
                        item={item}
                        look={GROUP_LOOK[g.id]}
                        term={g.id === 'all' ? '' : view.term}
                        active={i === active}
                        rise={riseOf(item.key)}
                        onHover={() => setActive(i)}
                        onPick={() => go(item)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div role="status" className={`uep-search-status${view.message ? '' : ' is-quiet'}`}>
            {searching ? <span className="sr-only">Searching…</span> : view.message}
          </div>
          <div className="uep-search-foot" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
            <span><kbd>↵</kbd> Open</span>
            <span><kbd>Esc</kbd> Close</span>
          </div>
        </div>
      </form>
    </div>
  )
}

