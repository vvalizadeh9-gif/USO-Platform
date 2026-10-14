import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'

/**
 * GET /explorer/sites/{id}: one request for the whole record page.
 *
 * `status` is 'loading' | 'ready' | 'error' | 'missing' (a 404: no such site,
 * or not one this person may see). `reload` refetches without dropping what
 * is on screen, after a Take action form has changed the site.
 */
export default function useSiteRecord(workItemId) {
  const [state, setState] = useState({ status: 'loading', data: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setState((s) => (s.data ? s : { status: 'loading', data: null }))
    api
      .get(`/explorer/sites/${encodeURIComponent(workItemId)}`)
      .then((r) => live && setState({ status: 'ready', data: r.data }))
      .catch((err) => {
        if (!live) return
        setState({ status: err.response?.status === 404 ? 'missing' : 'error', data: null })
      })
    return () => {
      live = false
    }
  }, [workItemId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry: reload, reload }
}
