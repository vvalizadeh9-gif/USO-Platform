import { useEffect, useState } from 'react'
import api from '../../api/client'

const STREAMS = ['DT', 'ACCEPTANCE']
const keyOf = (p) => (p?.year && p?.month ? `${p.year}-${p.month}` : '')

/**
 * The PM queue for both streams: the month on the Plans tab and the month
 * now running (its approved PIP and any pending revision).
 *
 * GET /pip/queue answers one stream per call, so this is two calls per
 * month, and two more for the running month unless it is the same month.
 * Nothing is computed here; see planBoard.js for what is made of it.
 *
 * Returns `{ state, planning, running, reload }`. `state` is `loading` until
 * the reads for *this* month are in (a response for a month the picker has
 * already left is dropped), then `ready`, `failed` or `denied` (a 403).
 */
export default function usePlanBoard({ period, running, enabled }) {
  const [board, setBoard] = useState({ key: '', state: 'loading' })
  const [tick, setTick] = useState(0)
  const key = keyOf(period)
  const runningKey = keyOf(running)

  useEffect(() => {
    if (!enabled || !key) return undefined
    let live = true
    const read = (p, stream) =>
      api.get('/pip/queue', { params: { year: p.year, month: p.month, stream } }).then((r) => r.data)
    const reads = STREAMS.map((s) => read(period, s))
    const separateRunning = runningKey && runningKey !== key
    if (separateRunning) reads.push(...STREAMS.map((s) => read(running, s)))

    Promise.all(reads)
      .then(([dt, acc, runDt, runAcc]) => {
        if (!live) return
        setBoard({
          key,
          state: 'ready',
          planning: { DT: dt, ACCEPTANCE: acc },
          running: runningKey
            ? separateRunning
              ? { DT: runDt, ACCEPTANCE: runAcc }
              : { DT: dt, ACCEPTANCE: acc }
            : null,
        })
      })
      .catch((err) => {
        if (live) setBoard({ key, state: err.response?.status === 403 ? 'denied' : 'failed' })
      })
    return () => {
      live = false
    }
    // period/running are read through their keys: a new object for the same
    // month is not a new month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, runningKey, tick])

  const current = board.key === key ? board : { key, state: 'loading' }
  return { ...current, reload: () => setTick((t) => t + 1) }
}
