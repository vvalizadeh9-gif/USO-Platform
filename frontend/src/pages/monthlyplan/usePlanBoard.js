import { useEffect, useState } from 'react'
import { peek, read } from './readCache'
import { STREAMS } from './streams'
const keyOf = (p) => (p?.year && p?.month ? `${p.year}-${p.month}` : '')

/** One stream's queue for one month, without the running month's figures. */
const params = (p, stream) => ({ year: p.year, month: p.month, stream, standing: false })

/**
 * The PM queue for every stream: the month on the Plans page and the month
 * now running (its approved PIP and any pending revision).
 *
 * GET /pip/queue answers one stream per call, so this is one call per stream
 * per month, and as many again for the running month unless it is the same
 * month. `standing=false` leaves out the running month's scorecard, which
 * none of these pages read and which is most of the call's cost.
 * Nothing is computed here; see planBoard.js for what is made of it.
 *
 * Returns `{ state, planning, running, reload }`. `state` is `loading` until
 * the reads for *this* month are in (a response for a month the picker has
 * already left is dropped), then `ready`, `failed` or `denied` (a 403). A
 * month read before is `ready` at once from the last answer, and refreshed.
 */
export default function usePlanBoard({ period, running, enabled }) {
  const key = keyOf(period)
  const runningKey = keyOf(running)
  const separateRunning = Boolean(runningKey && runningKey !== key)
  const [board, setBoard] = useState({ key: '', state: 'loading' })
  const [tick, setTick] = useState(0)

  const assemble = (responses) => {
    const byStream = (list) => Object.fromEntries(STREAMS.map((s, i) => [s, list[i]]))
    const planning = byStream(responses)
    return {
      key,
      state: 'ready',
      planning,
      running: runningKey ? (separateRunning ? byStream(responses.slice(STREAMS.length)) : planning) : null,
    }
  }
  const wanted = () => {
    const list = STREAMS.map((s) => params(period, s))
    if (separateRunning) list.push(...STREAMS.map((s) => params(running, s)))
    return list
  }

  useEffect(() => {
    if (!enabled || !key) return undefined
    let live = true
    Promise.all(wanted().map((p) => read('/pip/queue', p)))
      .then((responses) => live && setBoard(assemble(responses)))
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

  let current = board.key === key ? board : null
  if (!current && enabled && key) {
    const cached = wanted().map((p) => peek('/pip/queue', p))
    current = cached.every((c) => c !== undefined) ? assemble(cached) : { key, state: 'loading' }
  }
  return { ...(current ?? { key, state: 'loading' }), reload: () => setTick((t) => t + 1) }
}
