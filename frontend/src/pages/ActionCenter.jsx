import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api/client'
import PageFrame from '../components/PageFrame'
import { Banner, PageBar, Tabs } from '../components/ui'
import { plural, sortQueues, toQueue } from './actioncenter/format'
import { ENTRANCE_MS, usePrefersReducedMotion } from './actioncenter/motion'
import StageColumn from './actioncenter/StageColumn'
import { STEPS } from './actioncenter/stages'
import StepRail from './actioncenter/StepRail'

// The Action Center: how much is waiting on this person, how much of it is
// late, and at which lifecycle step -- one card per queue, each opening the
// screen where the work is done. Every number comes from
// GET /action-center/board, which counts each queue with the same read as the
// screen its card opens.
//
// The board scrolls in the page body when it is taller than the screen; the
// step rail stays pinned under the PageBar and no column scrolls by itself
// (design-system-cobalt.md, "Task board").
export default function ActionCenter() {
  const [board, setBoard] = useState(null)
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)
  const [tab, setTab] = useState('all')
  const reduced = usePrefersReducedMotion()
  const [entrance, setEntrance] = useState(() => !reduced)
  const animate = entrance && !reduced
  const mainRef = useRef(null)
  const boardRef = useRef(null)

  const load = useCallback(() => {
    setFailed(false)
    return api
      .get('/action-center/board')
      .then((r) => {
        setBoard(r.data)
        setLoadedAt(new Date())
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // The entrance plays once, for the first board shown; a refresh or a retry
  // never plays it again.
  const shown = Boolean(board)
  useEffect(() => {
    if (!shown) return undefined
    const id = setTimeout(() => setEntrance(false), ENTRANCE_MS)
    return () => clearTimeout(id)
  }, [shown])

  // Every step, all five, whether or not this person has work there.
  const steps = useMemo(() => {
    const now = loadedAt ?? new Date()
    const byKey = Object.fromEntries((board?.stages ?? []).map((s) => [s.key, s]))
    return Object.fromEntries(
      STEPS.map((step) => {
        const queues = sortQueues((byKey[step.key]?.tickets ?? []).map((t) => toQueue(t, step.key, now)))
        return [step.key, {
          queues,
          pending: queues.reduce((n, q) => n + q.count, 0),
          overdue: queues.reduce((n, q) => n + q.overdue, 0),
        }]
      }),
    )
  }, [board, loadedAt])

  const totals = useMemo(() => {
    const all = Object.values(steps)
    return { pending: all.reduce((n, s) => n + s.pending, 0), overdue: all.reduce((n, s) => n + s.overdue, 0) }
  }, [steps])

  const overdueOnly = tab === 'overdue'
  const toggleOverdue = useCallback(() => setTab((t) => (t === 'overdue' ? 'all' : 'overdue')), [])
  useOverdueKey(toggleOverdue)

  const loading = !board && !failed
  const caughtUp = Boolean(board) && !failed && totals.pending === 0

  const bar = (
    <>
      <a
        href="#ac-tasks"
        className="ac-skip"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Skip to tasks
      </a>
      <PageBar
        eyebrow="Today"
        title="Action Center"
        context={<Summary board={board} failed={failed} totals={totals} />}
        actions={<Freshness loadedAt={loadedAt} onRefresh={load} />}
        tabs={
          <Tabs
            label="Tasks"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'all', label: 'All tasks', count: board ? totals.pending : 0 },
              { key: 'overdue', label: 'Overdue', alert: totals.overdue > 0 ? `${totals.overdue} late` : null },
            ]}
          />
        }
        tabsRight={<KeyboardHint />}
      />
    </>
  )

  return (
    <PageFrame className={animate ? 'ac-page ac-animate' : 'ac-page'} bar={bar}>
      <div className="ac-main" id="ac-tasks" ref={mainRef} tabIndex={-1}>
        {failed && (
          <Banner tone="error" title="Your tasks didn't load." className="ac-banner">
            The server didn't answer in time. Nothing was lost.
            <div className="ac-banner-actions">
              <button type="button" className="btn ac-retry" onClick={load}>Retry</button>
            </div>
          </Banner>
        )}
        {caughtUp && (
          <Banner tone="success" title="All caught up." className="ac-banner">
            Nothing is waiting on you. New work appears here as soon as it reaches you.
          </Banner>
        )}
        {!failed && (
          <div
            className="ac-board"
            ref={boardRef}
            aria-busy={loading || undefined}
            onKeyDown={(e) => moveFocus(e, boardRef.current)}
          >
            {loading && <span className="sr-only">Loading your tasks</span>}
            <StepRail steps={board ? steps : null} loading={loading} />
            <div className="ac-columns ac-grid">
              {STEPS.map((step, column) => {
                const { queues } = steps[step.key]
                const shownQueues = overdueOnly ? queues.filter((q) => q.overdue > 0) : queues
                // Plans & Data sits past the Accepted gap, in the grid's sixth column.
                const gridColumn = step.alongside ? 5 : column
                return [
                  step.alongside && <div key="accepted" className="ac-col-gap" aria-hidden="true" />,
                  <StageColumn
                    key={step.key}
                    step={step}
                    column={gridColumn}
                    queues={shownQueues}
                    loading={loading}
                    emptyText={overdueOnly && queues.length > 0 ? 'Nothing overdue' : 'Nothing waiting on you'}
                    animate={animate}
                  />,
                ]
              })}
            </div>
          </div>
        )}
      </div>
    </PageFrame>
  )
}

/** "12 items waiting on you, 3 overdue" -- the page's one summary sentence. */
function Summary({ board, failed, totals }) {
  let text
  if (!board) {
    text = failed ? 'Your tasks didn’t load' : 'Loading your tasks…'
  } else if (totals.pending === 0) {
    text = 'Nothing is waiting on you'
  } else {
    text = (
      <>
        <b>{plural(totals.pending, 'item')}</b> waiting on you,{' '}
        {totals.overdue > 0 ? <b className="ac-summary-late">{totals.overdue} overdue</b> : 'none overdue'}
      </>
    )
  }
  return <p className="ac-summary" aria-live="polite">{text}</p>
}

/** "Updated just now" / "Updated at 09:41", then Refresh. */
function Freshness({ loadedAt, onRefresh }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])
  let text = null
  if (loadedAt) {
    const fresh = Date.now() - loadedAt.getTime() < 60000
    const hhmm = `${String(loadedAt.getHours()).padStart(2, '0')}:${String(loadedAt.getMinutes()).padStart(2, '0')}`
    text = fresh ? 'Updated just now' : `Updated at ${hhmm}`
  }
  return (
    <>
      {text && (
        <span className="ac-updated">
          <span className="ac-updated-dot" aria-hidden="true" />
          {text}
        </span>
      )}
      <button type="button" className="btn ac-refresh" aria-label="Refresh" onClick={onRefresh}>
        <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </>
  )
}

function KeyboardHint() {
  return (
    <p className="ac-keys">
      <kbd>↑↓←→</kbd> move · <kbd>Enter</kbd> open · <kbd>O</kbd> overdue
    </p>
  )
}

/** O toggles the Overdue tab, anywhere on the page but a text field. */
function useOverdueKey(toggle) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'o' && e.key !== 'O') return
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t instanceof Element && (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])
}

/**
 * Arrow keys between cards: Up/Down within a column, Left/Right to the
 * nearest card in the next column that has any. Enter is the link's own.
 */
function moveFocus(event, root) {
  const { key } = event
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) || !root) return
  const card = event.target.closest?.('[data-col]')
  if (!card) return
  const col = Number(card.dataset.col)
  const row = Number(card.dataset.row)
  const columns = new Map()
  for (const el of root.querySelectorAll('[data-col][data-row]')) {
    const c = Number(el.dataset.col)
    if (!columns.has(c)) columns.set(c, [])
    columns.get(c)[Number(el.dataset.row)] = el
  }
  let target = null
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    target = columns.get(col)?.[row + (key === 'ArrowDown' ? 1 : -1)]
  } else {
    const order = [...columns.keys()].sort((a, b) => a - b)
    const next = key === 'ArrowRight' ? order.find((c) => c > col) : order.reverse().find((c) => c < col)
    const cards = next === undefined ? null : columns.get(next)
    if (cards) target = cards[Math.min(row, cards.length - 1)]
  }
  if (!target) return
  event.preventDefault()
  target.focus()
}
