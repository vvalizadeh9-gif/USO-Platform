import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { useWork } from '../../components/work/WorkContext'

/**
 * A step's list: fetched on mount, again after every action on the page
 * (`version`) and on Retry. `rows` is null while the first read is out;
 * `error` is set when it failed, so the card says so instead of looking empty.
 */
export default function useStepData(url, params) {
  const { version } = useWork()
  const [state, setState] = useState({ rows: null, error: false })
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(params || null)

  useEffect(() => {
    let live = true
    api
      .get(url, params ? { params } : undefined)
      .then((r) => live && setState({ rows: r.data, error: false }))
      .catch(() => live && setState((s) => ({ rows: s.rows, error: true })))
    return () => {
      live = false
    }
    // `key` stands for `params`, which callers build inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, version, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}

/** Register what the page's Export button downloads for this step. */
export function useExportRows(onExport, columns, rows) {
  useEffect(() => {
    onExport?.(rows ? { columns, rows } : null)
  }, [onExport, columns, rows])
}
