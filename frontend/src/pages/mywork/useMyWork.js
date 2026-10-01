// My Work's data: the list and its counts, what is selected, and the focused
// village's detail. Everything the server decides arrives here as it is --
// tabs, counts, statuses, what can be filed -- and nothing is re-derived.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { detailMessage } from '../../lib/apiError'
import { fetchList, fetchRows, fetchVillage, resolveCodes } from './api'

export const PAGE_SIZE = 100
export const SORTS = [
  { key: 'waiting_longest', label: 'Waiting longest' },
  { key: 'waiting_shortest', label: 'Waiting shortest' },
  { key: 'name', label: 'Name' },
]
const SEARCH_DELAY_MS = 250

/** Two or more tokens that each carry a digit read as pasted codes. */
export function pastedCodes(text) {
  const tokens = String(text || '').split(/[\s,،;]+/).filter(Boolean)
  return tokens.length >= 2 && tokens.every((t) => /[0-9۰-۹٠-٩]/.test(t)) ? tokens : null
}

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return settled
}

export function useMyWork() {
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope') === 'universe' ? 'universe' : 'remaining'
  const authority = ['ICT', 'CRA'].includes(params.get('authority')) ? params.get('authority') : null
  const urlTab = params.get('tab')

  const [sort, setSort] = useState(SORTS[0].key)
  const [query, setQuery] = useState('')
  const settledQuery = useDebounced(query, SEARCH_DELAY_MS)
  const codes = useMemo(() => pastedCodes(settledQuery), [settledQuery])

  const [list, setList] = useState(null)
  const [listError, setListError] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [paste, setPaste] = useState(null)
  const [cache, setCache] = useState(() => new Map())
  const [focusId, setFocusId] = useState(null)
  const [ticked, setTicked] = useState([])
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const generation = useRef(0)

  const tab = urlTab || list?.tab || null
  const remember = useCallback((rows) => {
    setCache((old) => {
      const next = new Map(old)
      for (const row of rows) next.set(row.village_id, row)
      return next
    })
  }, [])

  const baseParams = useMemo(() => ({
    scope,
    sort,
    ...(urlTab ? { tab: urlTab } : {}),
    ...(authority ? { authority } : {}),
  }), [scope, sort, urlTab, authority])

  // The list (or, while codes are pasted, exactly the rows they matched).
  const load = useCallback(async () => {
    const mine = ++generation.current
    setListError(null)
    try {
      const data = await fetchList({
        ...baseParams,
        limit: PAGE_SIZE,
        ...(settledQuery && !codes ? { q: settledQuery } : {}),
      })
      let rows = data.rows
      let pasted = null
      if (codes) {
        const resolved = await resolveCodes(codes, scope)
        const ids = resolved.matched.map((m) => m.village_id)
        rows = ids.length ? (await fetchRows(ids, scope)).rows : []
        pasted = { ...resolved, ids }
      }
      if (mine !== generation.current) return
      remember(rows)
      setPaste(pasted)
      setList({ ...data, rows, next_cursor: codes ? null : data.next_cursor })
    } catch (err) {
      if (mine === generation.current) setListError(detailMessage(err, 'Could not load the villages'))
    }
  }, [baseParams, settledQuery, codes, scope, remember])

  useEffect(() => { load() }, [load])

  const loadMore = useCallback(async () => {
    if (!list?.next_cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchList({
        ...baseParams, tab: list.tab, limit: PAGE_SIZE, cursor: list.next_cursor,
        ...(settledQuery ? { q: settledQuery } : {}),
      })
      remember(data.rows)
      setList((old) => ({ ...old, rows: [...old.rows, ...data.rows], next_cursor: data.next_cursor }))
    } catch (err) {
      setListError(detailMessage(err, 'Could not load more villages'))
    } finally {
      setLoadingMore(false)
    }
  }, [list, loadingMore, baseParams, settledQuery, remember])

  const rows = useMemo(() => list?.rows || [], [list])

  // Focus follows the list: kept while it is still listed, else the first row.
  useEffect(() => {
    if (!rows.length) return
    if (focusId == null || !rows.some((r) => r.village_id === focusId)) setFocusId(rows[0].village_id)
  }, [rows, focusId])

  const multi = ticked.length > 1
  const currentId = ticked.length === 1 ? ticked[0] : focusId

  const currentRef = useRef(currentId)
  currentRef.current = currentId

  const loadDetail = useCallback(async (id) => {
    if (id == null) return
    setDetailError(null)
    try {
      const data = await fetchVillage(id)
      setDetail((old) => (id === currentRef.current ? data : old))
    } catch (err) {
      setDetailError(detailMessage(err, 'Could not load this village'))
    }
  }, [])

  useEffect(() => {
    if (multi) return
    setDetail((old) => (old?.village_id === currentId ? old : null))
    loadDetail(currentId)
  }, [currentId, multi, loadDetail])

  // Ticked villages can come from outside the loaded page (a paste, the same
  // site); their rows are fetched once and kept.
  const tick = useCallback(async (ids) => {
    const missing = ids.filter((id) => !cache.has(id))
    if (missing.length) {
      try {
        remember((await fetchRows(missing, scope)).rows)
      } catch {
        /* the rows that did load still show; the rest drop out below */
      }
    }
    setTicked(ids)
  }, [cache, remember, scope])

  const toggleTick = useCallback((id) => {
    setTicked((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]))
  }, [])

  const focus = useCallback((id) => {
    setTicked([])
    setFocusId(id)
  }, [])

  const step = useCallback((delta) => {
    if (!rows.length) return
    const index = rows.findIndex((r) => r.village_id === currentId)
    const next = rows[(index + delta + rows.length) % rows.length]
    focus(next.village_id)
  }, [rows, currentId, focus])

  const setTab = useCallback((key) => {
    setTicked([])
    setParams((old) => {
      const next = new URLSearchParams(old)
      next.set('tab', key)
      return next
    }, { replace: true })
  }, [setParams])

  const refresh = useCallback(async () => {
    await Promise.all([load(), multi ? null : loadDetail(currentRef.current)])
  }, [load, loadDetail, multi])

  const tickedRows = useMemo(
    () => ticked.map((id) => cache.get(id)).filter(Boolean),
    [ticked, cache],
  )

  return {
    scope, authority, tab, setTab, sort, setSort, query, setQuery,
    list, rows, listError, loadMore, loadingMore, paste,
    focusId: currentId, focus, step, ticked, tickedRows, multi, tick, toggleTick,
    clearTicks: () => setTicked([]),
    detail: detail?.village_id === currentId ? detail : null,
    detailError, refresh, cache,
  }
}
