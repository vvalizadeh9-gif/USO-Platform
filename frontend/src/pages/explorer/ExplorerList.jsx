import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useFillPage } from '../../components/pageMode'
import RecentActions from '../../components/work/RecentActions'
import { WorkProvider, useWork } from '../../components/work/WorkContext'
import { StepError } from '../../components/work/parts'
import { useToast } from '../../context/ToastContext'
import { describeBlobError, saveBlob } from '../../lib/download'
import { EXPLORER_PATH, explorerListPath } from '../../lib/explorerLinks'
import AppFooter from '../../shell/AppFooter'
import { useHomeData } from '../../shell/HomeData'
import BulkBar from './BulkBar'
import FilterPills from './FilterPills'
import SiteRows from './SiteRows'
import {
  apiParams, countText, isFiltered, listParams, nextSort, readListState, recallList, rememberList,
} from './listModel'
import useSiteList from './useSiteList'
import '../../styles/home.css'
import '../../styles/work.css'
import '../../styles/explorer.css'

const SEARCH_DELAY = 250

/**
 * Explorer (UEP-11a §B, redesigned in UEP-28 Part A): the list of all sites,
 * for finding one fast and opening its record. The title row on the page
 * background, then one card: search and filter pills on top, the sortable
 * table (the only thing that scrolls) below. No footer: the count is the
 * title's pill and the keyboard hints are the search box's tooltip. Search,
 * filters and sort live in the URL.
 */
export default function ExplorerList() {
  useFillPage()
  return (
    <WorkProvider>
      <SitesPage />
    </WorkProvider>
  )
}

/** The header search's old links (?province_id=, ?contractor_id=) as filters. */
function useLegacyLinks(params, setParams) {
  useEffect(() => {
    const province = params.get('province_id')
    const contractor = params.get('contractor_id')
    if (!province && !contractor && !params.has('stage')) return
    const next = new URLSearchParams(params)
    for (const old of ['province_id', 'contractor_id', 'stage']) next.delete(old)
    if (province) next.set('province', province)
    if (contractor) next.set('dt_contractor', contractor)
    setParams(next, { replace: true })
  }, [params, setParams])
}

/** The count of every site the person can see, whatever the view. */
function useAllTotal(list, filtered) {
  const [all, setAll] = useState(null)
  useEffect(() => {
    if (!filtered && list.status === 'ready') setAll(list.total)
  }, [filtered, list.status, list.total])
  useEffect(() => {
    if (!filtered || all != null) return
    api.get('/explorer/sites', { params: { limit: 1 } }).then(({ data }) => setAll(data.total)).catch(() => {})
  }, [filtered, all])
  return all
}

function SitesPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const { search } = useLocation()
  const { headingRef } = useWork()
  const { data: home, error: homeError } = useHomeData()
  const [params, setParams] = useSearchParams()
  useLegacyLinks(params, setParams)

  const historyOpen = params.get('view') === 'history'
  const state = useMemo(() => readListState(params), [params])
  const filtered = isFiltered(state)
  const viewKey = JSON.stringify(apiParams(state))
  const list = useSiteList(state, search)
  const allTotal = useAllTotal(list, filtered)
  const [options, setOptions] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [expanded, setExpanded] = useState(null)
  const [villages, setVillages] = useState({})
  const [exporting, setExporting] = useState(false)
  const scrollRef = useRef(null)

  const setState = useCallback(
    (patch) => setParams(listParams({ ...state, ...patch }), { replace: true }),
    [state, setParams],
  )

  useEffect(() => {
    api.get('/explorer/sites/filters').then(({ data }) => setOptions(data)).catch(() => {})
  }, [])
  // A new view: a new selection and nothing expanded.
  useEffect(() => {
    setSelected(new Set())
    setExpanded(null)
  }, [viewKey])

  const onScroll = useScrollMemory(scrollRef, list, search)

  const toggleFilter = (key, value) => setState({ filters: { ...state.filters, [key]: value || undefined } })
  const clearAll = () => setParams({}, { replace: true })

  const onSelect = useCallback((id, on) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const onSelectAll = (on) => setSelected(on ? new Set(list.items.map((r) => r.id)) : new Set())

  const villagesRef = useRef(villages)
  villagesRef.current = villages
  const onToggle = useCallback((id) => {
    setExpanded((open) => (open === id ? null : id))
    const known = villagesRef.current[id]?.status
    if (known === 'ready' || known === 'loading') return
    setVillages((v) => ({ ...v, [id]: { status: 'loading' } }))
    api
      .get(`/explorer/sites/${id}/villages`)
      .then(({ data }) => setVillages((v) => ({ ...v, [id]: { status: 'ready', list: data } })))
      .catch(() => setVillages((v) => ({ ...v, [id]: { status: 'error' } })))
  }, [])

  async function exportSites(ids) {
    setExporting(true)
    try {
      const res = await api.get('/explorer/sites/export', {
        params: { ...apiParams(state), ...(ids ? { ids } : {}) },
        paramsSerializer: { indexes: null },
        responseType: 'blob',
      })
      saveBlob(res.data, ids ? 'selected_sites.xlsx' : 'explorer_sites.xlsx')
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  async function copyIds() {
    const codes = list.items.filter((r) => selected.has(r.id)).map((r) => r.site_code)
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast.success(`${codes.length} ${codes.length === 1 ? 'ID' : 'IDs'} copied`)
    } catch {
      toast.error('Copy failed', 'Your browser did not allow copying.')
    }
  }

  return (
    <div className="uep-home uw-page exl-page">
      <TitleRow
        headingRef={headingRef}
        count={countText(list.total, allTotal, filtered)}
        filtered={filtered}
        historyOpen={historyOpen}
        onHistory={() => navigate(historyOpen ? EXPLORER_PATH : explorerListPath({ view: 'history' }))}
        onExport={historyOpen ? undefined : () => exportSites(null)}
        exporting={exporting}
      />
      {historyOpen ? (
        <div className="uw-content">
          <RecentActions panelProps={{ id: 'sites-panel', 'aria-label': 'History' }} />
        </div>
      ) : (
        <section className="uw-card exl-card" aria-label="All sites">
          <header className="exl-toolbar">
            <SearchField value={state.q} onChange={(q) => setState({ q })} />
            <FilterPills
              options={options}
              filters={state.filters}
              onChange={toggleFilter}
              onClear={() => setState({ filters: {} })}
            />
          </header>
          <div className="uw-card-body exl-body" ref={scrollRef} onScroll={onScroll}>
            {list.status === 'error' ? (
              <StepError stepName="sites" onRetry={list.retry} />
            ) : list.status === 'ready' && list.items.length === 0 ? (
              <NoMatch filtered={filtered} onClear={clearAll} />
            ) : (
              <SiteRows
                list={list}
                state={state}
                onSort={(key) => setState(nextSort(state, key))}
                selected={selected}
                onSelect={onSelect}
                onSelectAll={onSelectAll}
                expanded={expanded}
                villages={villages}
                onToggle={onToggle}
                scrollRef={scrollRef}
              />
            )}
          </div>
          <BulkBar
            count={selected.size}
            exporting={exporting}
            onExport={() => exportSites([...selected])}
            onCopy={copyIds}
            onClear={() => setSelected(new Set())}
          />
        </section>
      )}
      <AppFooter data={home} failed={Boolean(homeError) && !home} />
    </div>
  )
}

/**
 * Remember the loaded pages and scroll offset on the way out, and put the
 * offset back when this same view is restored (UEP-11a §B6). Returns the
 * body's onScroll handler.
 */
function useScrollMemory(scrollRef, list, search) {
  const latest = useRef({ list, search })
  latest.current = { list, search }
  const top = useRef(0)
  const kept = useRef(recallList(search))

  useLayoutEffect(() => {
    const restore = kept.current
    kept.current = null
    if (restore && scrollRef.current) scrollRef.current.scrollTop = restore.scrollTop
  }, [scrollRef])

  useEffect(() => () => {
    const { list: l, search: s } = latest.current
    if (l.status === 'ready') {
      rememberList(s, { items: l.items, total: l.total, nextCursor: l.nextCursor, scrollTop: top.current })
    }
  }, [])

  return useCallback((e) => {
    top.current = e.currentTarget.scrollTop
  }, [])
}

/**
 * The title row (UEP-28 §A1), on the page background and aligned with the
 * card: Explorer's app tile, the title, the count pill ("97 of 4,201 sites"
 * while searching or filtering, announced politely), History and Export.
 */
function TitleRow({ headingRef, count, filtered, historyOpen, onHistory, onExport, exporting }) {
  return (
    <div className="exl-title-row">
      <span className="exl-app-tile" aria-hidden="true"><Icon name="search--locate" size={20} /></span>
      <h1 ref={headingRef} tabIndex={-1}>Explorer</h1>
      <span className={`exl-count uw-num ${filtered ? 'is-filtered' : ''}`.trim()} role="status" aria-live="polite">
        {count}
      </span>
      <span className="exl-title-spacer" />
      <button
        type="button"
        className={`uw-btn ${historyOpen ? 'is-current' : ''}`.trim()}
        aria-current={historyOpen ? 'page' : undefined}
        onClick={onHistory}
      >
        <Icon name="recently-viewed" size={16} /> History
      </button>
      {onExport && (
        <button type="button" className="uw-btn" onClick={onExport} disabled={exporting} aria-busy={exporting || undefined}>
          <Icon name="download" size={16} /> Export
        </button>
      )}
    </div>
  )
}

/** "/" anywhere on the page (outside a text field) focuses the search. */
function useSlashFocus(inputRef) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inputRef])
}

const SEARCH_HINT = 'Find a site by ID, village ID, village name or province'

/** The search field: 440px, the "/" hint, clear button, Esc clears. The URL
 * updates a moment after typing stops. */
function SearchField({ value, onChange }) {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  const inputRef = useRef(null)
  useSlashFocus(inputRef)
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value
      setText(value)
    }
  }, [value])
  useEffect(() => {
    const term = text.trim()
    if (term === sent.current) return undefined
    const t = setTimeout(() => {
      sent.current = term
      onChange(term)
    }, SEARCH_DELAY)
    return () => clearTimeout(t)
  }, [text, onChange])

  const clear = () => {
    setText('')
    sent.current = ''
    onChange('')
  }
  return (
    <label className="exl-search" title="/ to search · ↑ ↓ to move · Enter to open">
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        type="search"
        value={text}
        placeholder={SEARCH_HINT}
        aria-label={SEARCH_HINT}
        aria-keyshortcuts="/"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault()
            clear()
          }
        }}
      />
      {text ? (
        <button type="button" className="exl-search-clear" aria-label="Clear search" onClick={clear}>
          <Icon name="close" size={16} />
        </button>
      ) : (
        <kbd className="exl-slash" aria-hidden="true">/</kbd>
      )}
    </label>
  )
}

function NoMatch({ filtered, onClear }) {
  return (
    <div className="uw-state">
      <span className="uw-state-icon"><Icon name="search" size={20} /></span>
      <b>{filtered ? 'No sites match' : 'No sites yet'}</b>
      {filtered && (
        <>
          <span>Change the search or remove a filter.</span>
          <button type="button" className="uw-btn" onClick={onClear}>Clear search and filters</button>
        </>
      )}
    </div>
  )
}
