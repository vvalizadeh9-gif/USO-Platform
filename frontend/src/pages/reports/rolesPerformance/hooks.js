// Data and motion hooks for Roles Performance.
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../../api/client'
import { describeBlobError, filenameFrom, saveBlob } from '../../../lib/download'
import { prefersReducedMotion } from './model'

function readError(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/** GET `path` with `params`; refetched whenever the params change. */
export function useRpData(path, params) {
  const key = JSON.stringify(params ?? {})
  const [state, setState] = useState({ data: null, error: '', loading: true })

  useEffect(() => {
    let live = true
    setState((s) => ({ data: s.data, error: '', loading: true }))
    api
      .get(path, { params: JSON.parse(key) })
      .then((r) => live && setState({ data: r.data, error: '', loading: false }))
      .catch((err) => live && setState({
        data: null, error: readError(err, 'Could not load this view.'), loading: false,
      }))
    return () => {
      live = false
    }
  }, [path, key])

  return state
}

/** The Excel button: the same params as the screen, so the same numbers. */
export function useExport(path, params, fallbackName) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = JSON.stringify(params ?? {})

  const run = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const response = await api.get(path, { params: JSON.parse(key), responseType: 'blob' })
      saveBlob(response.data, filenameFrom(response.headers, fallbackName))
    } catch (err) {
      setError(await describeBlobError(err))
    } finally {
      setBusy(false)
    }
  }, [path, key, fallbackName])

  return { run, busy, error }
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3

/**
 * A number that counts up to `value` over `duration` ms, ease-out-cubic.
 * With reduced motion (and in tests) it is the end value from the start.
 */
export function useCountUp(value, duration = 1100) {
  const reduced = prefersReducedMotion()
  const [shown, setShown] = useState(reduced || value == null ? value : 0)
  const frame = useRef(null)

  useEffect(() => {
    if (reduced || value == null) {
      setShown(value)
      return undefined
    }
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1)
      setShown(value * easeOutCubic(t))
      if (t < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [value, duration, reduced])

  return shown
}
