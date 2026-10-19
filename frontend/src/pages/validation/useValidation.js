// The validation page's data: the list of letters or sites with its counts
// and filters, the open group, and which filings are held for Undo. The
// server decides every rule -- what waits, what is late, what is missing --
// and nothing here re-derives it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detailMessage } from '../../lib/apiError'
import { fetchGroup, fetchValidation } from './api'

export const VIEW_LETTER = 'letter'
export const VIEW_SITE = 'site'
const SEARCH_DELAY_MS = 250

/** The view a user last chose, per user (UEP-16 §3: remembered). */
const viewKey = (userId) => `uep.validation.view.${userId ?? 'anon'}`

export function readView(userId) {
  try {
    return window.localStorage.getItem(viewKey(userId)) === VIEW_SITE ? VIEW_SITE : VIEW_LETTER
  } catch {
    return VIEW_LETTER
  }
}

function writeView(userId, view) {
  try {
    window.localStorage.setItem(viewKey(userId), view)
  } catch {
    /* private window: the choice lasts for this visit only */
  }
}

export const NO_FILTERS = Object.freeze({ late: false, has_rejection: false, contractor_id: '', province_id: '', region_id: '' })

export const hasFilters = (filters, q) => Boolean(
  q?.trim() || filters.late || filters.has_rejection || filters.contractor_id || filters.province_id || filters.region_id,
)

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return settled
}

function listParams(authority, view, filters, q) {
  const params = { authority, group: view, limit: 500 }
  if (filters.late) params.late = true
  if (filters.has_rejection) params.has_rejection = true
  for (const key of ['contractor_id', 'province_id', 'region_id']) if (filters[key]) params[key] = filters[key]
  if (q.trim()) params.q = q.trim()
  return params
}

export function useValidation(authority, userId) {
  const [view, setViewState] = useState(() => readView(userId))
  const [filters, setFilters] = useState(NO_FILTERS)
  const [query, setQuery] = useState('')
  const q = useDebounced(query, SEARCH_DELAY_MS)

  const [list, setList] = useState(null)
  const [listError, setListError] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  /** Filings held for Undo: out of the table until sent or undone. */
  const [held, setHeld] = useState(() => new Set())
  const generation = useRef(0)
  const selectedRef = useRef(selectedKey)
  selectedRef.current = selectedKey

  const setView = useCallback((next) => {
    setViewState(next)
    writeView(userId, next)
    setSelectedKey(null)
  }, [userId])

  const loadList = useCallback(async () => {
    const mine = ++generation.current
    setListError(null)
    try {
      const data = await fetchValidation(listParams(authority, view, filters, q))
      if (mine === generation.current) setList(data)
    } catch (err) {
      if (mine === generation.current) setListError(detailMessage(err, 'Could not load the filings'))
    }
  }, [authority, view, filters, q])

  useEffect(() => { loadList() }, [loadList])

  const groups = useMemo(() => list?.groups || [], [list])

  // The selection follows the list: kept while listed, else the first group.
  useEffect(() => {
    if (!groups.length) {
      setSelectedKey(null)
      return
    }
    if (!groups.some((g) => g.key === selectedKey)) setSelectedKey(groups[0].key)
  }, [groups, selectedKey])

  const loadDetail = useCallback(async (key) => {
    if (key == null) {
      setDetail(null)
      return
    }
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await fetchGroup(view, key, authority)
      setDetail((old) => (key === selectedRef.current ? data : old))
    } catch (err) {
      if (err?.response?.status === 404) setDetail(null)
      else setDetailError(detailMessage(err, 'Could not load this group'))
    } finally {
      setDetailLoading(false)
    }
  }, [view, authority])

  useEffect(() => {
    setDetail((old) => (old?.group?.key === selectedKey ? old : null))
    loadDetail(selectedKey)
  }, [selectedKey, loadDetail])

  const refresh = useCallback(async () => {
    await Promise.all([loadList(), loadDetail(selectedRef.current)])
  }, [loadList, loadDetail])

  const hold = useCallback((ids) => setHeld((old) => new Set([...old, ...ids])), [])
  const release = useCallback((ids) => setHeld((old) => {
    const next = new Set(old)
    for (const id of ids) next.delete(id)
    return next
  }), [])

  const clearFilters = useCallback(() => {
    setFilters(NO_FILTERS)
    setQuery('')
  }, [])

  return {
    view, setView, filters, setFilters, query, setQuery, clearFilters,
    filtered: hasFilters(filters, q),
    list, groups, listError, loadList,
    selectedKey, select: setSelectedKey,
    detail: detail?.group?.key === selectedKey ? detail : null,
    detailError, detailLoading, refresh,
    held, hold, release,
  }
}
