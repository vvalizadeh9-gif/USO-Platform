import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { BAND_STREAMS } from './planBoard'
import { peek, read } from './readCache'

const MONTHS = ['planning', 'running']
const keyOf = (month, stream) => `${month}:${stream}`
const paramsOf = (period, stream) => ({ stream, year: period.year, month: period.month })
const figures = (data) => ({ current: data.current?.target_count ?? null, previous: data.previous?.target_count ?? null })

/**
 * The Internal PIP targets for the planning and the running month, both
 * streams, and the edits made to them on the page.
 *
 * GET /pip/internal-target answers one stream and month per call, with the
 * month before it (`previous`): the page's "last month" figure. Edits are kept
 * as drafts, one per month and stream; `save` writes every changed one
 * through PUT /pip/internal-target (a new version each, PM only) and `discard`
 * drops them. A target nobody has set reads as 0 and is not "changed" until
 * it moves off 0.
 *
 * Returns `{ state, current, value, previous, setDraft, dirty, saving, saved,
 * save, discard }`: `current` is the saved target (null when none is set),
 * `value` the number on screen. `state` is `loading`, `ready`, `failed` or `denied`.
 */
export default function useInternalTargets({ planning, running, enabled }) {
  const toast = useToast()
  const [result, setResult] = useState({ state: 'loading', targets: {} })
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tick, setTick] = useState(0)
  const periods = { planning, running }
  const key = `${planning?.year}-${planning?.month}|${running?.year}-${running?.month}`
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled || !planning || !running) return undefined
    let alive = true
    const reads = MONTHS.flatMap((month) =>
      BAND_STREAMS.map((stream) =>
        read('/pip/internal-target', paramsOf(periods[month], stream)).then((data) => [keyOf(month, stream), figures(data)]),
      ),
    )
    Promise.all(reads)
      .then((entries) => alive && setResult({ state: 'ready', targets: Object.fromEntries(entries) }))
      .catch((err) => alive && setResult({ state: err.response?.status === 403 ? 'denied' : 'failed', targets: {} }))
    return () => {
      alive = false
    }
    // The periods are read through their key: a new object for the same month is not a new month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, tick])

  // Months read before draw at once from the last answer while the new one comes.
  let shown = result
  if (shown.state === 'loading' && enabled && planning && running) {
    const cached = MONTHS.flatMap((month) =>
      BAND_STREAMS.map((stream) => [keyOf(month, stream), peek('/pip/internal-target', paramsOf(periods[month], stream))]),
    )
    if (cached.every(([, data]) => data !== undefined)) {
      shown = { state: 'ready', targets: Object.fromEntries(cached.map(([k, data]) => [k, figures(data)])) }
    }
  }

  const current = (month, stream) => shown.targets[keyOf(month, stream)]?.current ?? null
  const baseline = (month, stream) => current(month, stream) ?? 0
  const value = (month, stream) => drafts[keyOf(month, stream)] ?? baseline(month, stream)
  const previous = (month, stream) => shown.targets[keyOf(month, stream)]?.previous ?? null
  const dirty = MONTHS.flatMap((month) => BAND_STREAMS.map((stream) => [month, stream])).filter(
    ([month, stream]) => drafts[keyOf(month, stream)] != null && drafts[keyOf(month, stream)] !== baseline(month, stream),
  )

  const setDraft = useCallback((month, stream, n) => {
    setSaved(false)
    setDrafts((d) => ({ ...d, [keyOf(month, stream)]: n }))
  }, [])

  const discard = useCallback(() => setDrafts({}), [])

  async function save() {
    if (dirty.length === 0 || saving) return
    setSaving(true)
    const results = await Promise.allSettled(
      dirty.map(([month, stream]) =>
        api.put('/pip/internal-target', {
          stream,
          year: periods[month].year,
          month: periods[month].month,
          target_count: drafts[keyOf(month, stream)],
        }),
      ),
    )
    if (!live.current) return
    setSaving(false)
    const failed = dirty.filter((_, i) => results[i].status === 'rejected')
    // What was saved is no longer a draft; what failed stays on screen to retry.
    setDrafts((d) => Object.fromEntries(failed.map(([month, stream]) => [keyOf(month, stream), d[keyOf(month, stream)]])))
    if (failed.length === 0) {
      setSaved(true)
      toast.success('Internal PIP saved')
    } else {
      const detail = results.find((r) => r.status === 'rejected')?.reason?.response?.data?.detail
      toast.error('Could not save the Internal PIP', detail || 'Please try again.')
    }
    setTick((t) => t + 1)
    return failed.length === 0
  }

  return {
    state: shown.state,
    current,
    value,
    previous,
    setDraft,
    dirty: dirty.length > 0,
    changed: (month, stream) => dirty.some(([m, s]) => m === month && s === stream),
    saving,
    saved,
    save,
    discard,
    reload: () => setTick((t) => t + 1),
  }
}
