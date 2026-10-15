import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { PAGE_SIZE, apiParams, recallList } from './listModel'

/**
 * The list's rows, page by page (UEP-11a §B6): the first page whenever the
 * search, filters or sort change, the next one on `loadMore`. Each answer is
 * dropped if the view changed while it was in flight.
 *
 * `search` is the URL's query string: when the person comes back to the view
 * they left, its loaded pages are restored instead of fetched again.
 *
 * status: 'loading' (first page) | 'ready' | 'error'. `fresh` counts new first
 * pages, so the rows can rise in again after a new result and not on a
 * continued scroll.
 */
export default function useSiteList(state, search) {
  const key = JSON.stringify(apiParams(state))
  const [list, setList] = useState(() => initial(search))
  const [attempt, setAttempt] = useState(0)
  const live = useRef(key)
  const restored = useRef(Boolean(recallList(search)))

  useEffect(() => {
    live.current = key
    if (restored.current) {
      restored.current = false
      return
    }
    setList((l) => ({ ...l, status: 'loading', items: [], nextCursor: null, more: false }))
    api
      .get('/explorer/sites', { params: { ...JSON.parse(key), limit: PAGE_SIZE } })
      .then(({ data }) => {
        if (live.current !== key) return
        setList((l) => ({
          status: 'ready', items: data.items, total: data.total, nextCursor: data.next_cursor,
          more: false, moreError: false, fresh: l.fresh + 1,
        }))
      })
      .catch(() => live.current === key && setList((l) => ({ ...l, status: 'error' })))
  }, [key, attempt])

  const current = useRef(list)
  current.current = list
  const loadMore = useCallback(() => {
    const l = current.current
    if (l.status !== 'ready' || !l.nextCursor || l.more) return
    const asked = key
    current.current = { ...l, more: true }
    setList((m) => ({ ...m, more: true, moreError: false }))
    api
      .get('/explorer/sites', { params: { ...JSON.parse(asked), limit: PAGE_SIZE, cursor: l.nextCursor } })
      .then(({ data }) => {
        if (live.current !== asked) return
        setList((m) => ({
          ...m, items: [...m.items, ...data.items], total: data.total,
          nextCursor: data.next_cursor, more: false,
        }))
      })
      .catch(() => live.current === asked && setList((m) => ({ ...m, more: false, moreError: true })))
  }, [key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...list, loadMore, retry }
}

function initial(search) {
  const kept = recallList(search)
  if (kept) {
    return {
      status: 'ready', items: kept.items, total: kept.total, nextCursor: kept.nextCursor,
      more: false, moreError: false, fresh: 0,
    }
  }
  return { status: 'loading', items: [], total: null, nextCursor: null, more: false, moreError: false, fresh: 0 }
}
