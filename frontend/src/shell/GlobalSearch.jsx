import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { roleLabel } from '../lib/roles'
import { EXPLORER_PATH, explorerListPath, siteRecordPath } from '../lib/explorerLinks'
import { appState } from './appRegistry'

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

/** Server results start at this many characters (GET /search refuses fewer). */
const MIN_QUERY = 2
const DEBOUNCE_MS = 200
const MAX_PAGES = 6

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
          meta: [s.province, s.stage].filter(Boolean).join(' · '),
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
          meta: `${p.username} · ${roleLabel(p.role)}`,
          to: `/admin?tab=users&search=${encodeURIComponent(p.username)}`,
        })),
      },
    )
  }
  return groups.filter((g) => g.items.length > 0)
}

/**
 * The header search: apps and pages match as you type, and from two
 * characters on, sites, villages, provinces, contractors and (for an Admin)
 * people come from GET /search, each scoped to what this person can open.
 * Arrow keys move through the results, Enter opens one, Escape closes.
 */
export default function GlobalSearch({ apps }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
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
        items: [{ key: 'all-sites', label: `Search all sites for “${term}”`, to: explorerListPath({ q: term }), icon: 'search' }],
      })
    }
    return found
  }, [apps, term, remote, canListSites])
  const options = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => setActive(0), [term])

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
      if (open && term) {
        e.preventDefault()
        close()
      } else {
        inputRef.current?.blur()
      }
      return
    }
    if (!options.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + options.length) % options.length)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    go(options[active] ?? options[0])
  }

  const showing = open && term.length > 0
  const searching = remote.loading || (term.length >= MIN_QUERY && remote.term !== term)
  const optionId = (i) => `${listId}-opt-${i}`
  let index = -1

  return (
    <form
      className="uep-search"
      role="search"
      onSubmit={onSubmit}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close()
      }}
    >
      <Icon name="search" size={16} />
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
      <kbd aria-hidden="true">{SHORTCUT}</kbd>
      {showing && (
        <div className="uep-pop uep-search-results" id={listId} role="listbox" aria-label="Search results">
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label || undefined} className="uep-search-group">
              {g.label && <div className="uep-search-group-label" aria-hidden="true">{g.label}</div>}
              {g.items.map((item) => {
                index += 1
                const i = index
                return (
                  <button
                    key={item.key}
                    id={optionId(i)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    className={`uep-search-option ${i === active ? 'is-active' : ''}`.trim()}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(item)}
                  >
                    {item.icon && <Icon name={item.icon} size={16} />}
                    <span className="uep-search-option-label">{item.label}</span>
                    {item.meta && <span className="uep-search-option-meta">{item.meta}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {searching && <div className="uep-search-status" role="status">Searching…</div>}
          {!searching && options.length === 0 && (
            <div className="uep-search-status" role="status">
              {term.length < MIN_QUERY ? 'Type one more character to search sites and villages.' : `Nothing matches “${term}”.`}
            </div>
          )}
        </div>
      )}
    </form>
  )
}
