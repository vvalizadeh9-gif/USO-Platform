import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useFillPage } from '../../components/pageMode'
import PageHeading from '../../components/work/PageHeading'
import RecentActions from '../../components/work/RecentActions'
import { WorkProvider, useWork } from '../../components/work/WorkContext'
import { Fa, StepError } from '../../components/work/parts'
import { useToast } from '../../context/ToastContext'
import { describeBlobError, saveBlob } from '../../lib/download'
import { EXPLORER_PATH, explorerListPath } from '../../lib/explorerLinks'
import AppFooter from '../../shell/AppFooter'
import { useHomeData } from '../../shell/HomeData'
import BulkBar from './BulkBar'
import FilterPopover from './FilterPopover'
import SiteRows from './SiteRows'
import {
  FILTER_FIELDS, apiParams, fieldOptions, footerText, isFiltered, listParams, nextSort,
  readListState, recallList, rememberList,
} from './listModel'
import useSiteList from './useSiteList'
import '../../styles/home.css'
import '../../styles/work.css'
import '../../styles/explorer.css'

const SEARCH_DELAY = 250

/**
 * Explorer (UEP-11a §B): the list of all sites, for finding one fast and
 * opening its record. One card: search, filter chips and Filter on top, the
 * sortable table in the middle (the only thing that scrolls), the count and
 * keyboard hints at the foot. Search, filters and sort live in the URL.
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

  const foot = list.total != null ? footerText(list.items.length, list.total, filtered) : null

  return (
    <div className="uep-home uw-page exl-page">
      <PageHeading
        title="Explorer"
        count={allTotal}
        pill
        headingRef={headingRef}
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
            <FilterChips state={state} options={options} onRemove={(key) => toggleFilter(key, null)} />
            <span className="exl-toolbar-spacer" />
            <FilterPopover options={options} filters={state.filters} onToggle={toggleFilter} />
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
          <footer className="exl-footer">
            <span role="status">
              {foot && <>Showing <b className="uw-num">{foot.shown}</b> {foot.rest}</>}
            </span>
            <span className="exl-keys" aria-hidden="true">
              <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open
            </span>
          </footer>
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

/** The search field: 380px, clear button, Esc clears. The URL updates a
 * moment after typing stops. */
function SearchField({ value, onChange }) {
  const [text, setText] = useState(value)
  const sent = useRef(value)
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
    <label className="exl-search">
      <Icon name="search" size={16} />
      <input
        type="search"
        value={text}
        placeholder="Find a site by ID, village ID or village name"
        aria-label="Find a site by ID, village ID, village name or province"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault()
            clear()
          }
        }}
      />
      {text && (
        <button type="button" className="exl-search-clear" aria-label="Clear search" onClick={clear}>
          <Icon name="close" size={16} />
        </button>
      )}
    </label>
  )
}

/** "Province کرمان ×" for each active filter. */
function FilterChips({ state, options, onRemove }) {
  const chips = FILTER_FIELDS.filter((f) => state.filters[f.key])
  if (chips.length === 0) return null
  return (
    <ul className="exl-chips" aria-label="Active filters">
      {chips.map((f) => {
        const value = state.filters[f.key]
        const label = fieldOptions(f, options).find((o) => o.value === value)?.label ?? value
        return (
          <li key={f.key} className="exl-chip">
            {f.label} <b>{f.persian ? <Fa>{label}</Fa> : label}</b>
            <button type="button" className="exl-chip-remove" aria-label={`Remove ${f.label} filter`} onClick={() => onRemove(f.key)}>
              <Icon name="close" size={16} />
            </button>
          </li>
        )
      })}
    </ul>
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
