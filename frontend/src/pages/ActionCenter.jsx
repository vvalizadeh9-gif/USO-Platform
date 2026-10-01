import { CheckCircle2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../api/client'
import PageFrame from '../components/PageFrame'
import { Banner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { shamsiDayLabel } from '../lib/shamsi'
import { useCountUp, usePrefersReducedMotion } from './actioncenter/motion'
import StageColumn, { StageColumnPlaceholder } from './actioncenter/StageColumn'
import { expectedStages } from './actioncenter/stages'

// The Action Center: everything waiting on this person, across the lifecycle
// from Health Check to acceptance, as one ticket per queue in one column per
// stage. Every number comes from GET /action-center/board, which counts each
// queue with the same read as the screen its ticket opens.
//
// One screen, never scrolled: a column with more tickets than fit scrolls
// inside itself (see design-system-cobalt.md, "Ticket board").
export default function ActionCenter() {
  const { user } = useAuth()
  const [board, setBoard] = useState(null)
  const [failed, setFailed] = useState(false)
  const reduced = usePrefersReducedMotion()

  const load = useCallback(() => {
    setFailed(false)
    api
      .get('/action-center/board')
      .then((r) => setBoard(r.data))
      .catch(() => setFailed(true))
  }, [])

  useEffect(load, [load])

  // Animate once, on the first board shown; never on a reload or retry.
  const [animate] = useState(() => !reduced)

  return (
    <PageFrame className="ac-page">
      <BoardHeader totals={board?.totals} animate={animate && !reduced} />
      {failed ? (
        <Banner tone="error" title="The Action Center could not be loaded">
          <p>Your work is unchanged. Try again in a moment.</p>
          <button type="button" className="btn btn-sm" onClick={load}>Retry</button>
        </Banner>
      ) : !board ? (
        <BoardLoading roleName={user?.role?.name} />
      ) : board.stages.length === 0 ? (
        <AllCaughtUp />
      ) : (
        <div
          className="ac-board"
          style={{ '--ac-cols': board.stages.length }}
          aria-label="Pending work by stage"
        >
          {board.stages.map((stage, column) => (
            <StageColumn
              key={stage.key}
              stage={stage}
              column={column}
              animate={animate && !reduced}
            />
          ))}
        </div>
      )}
    </PageFrame>
  )
}

function BoardHeader({ totals, animate }) {
  const pending = useCountUp(totals?.pending ?? 0, { animate })
  const overdue = useCountUp(totals?.overdue ?? 0, { animate })
  const today = shamsiDayLabel(new Date())
  return (
    <header className="ac-head">
      <div>
        {today && <div className="ac-today" lang="fa">{today}</div>}
        <h1 className="ac-title">Action Center</h1>
      </div>
      <div className="ac-figures" aria-live="polite">
        {totals ? (
          <>
            <span className="ac-figure" aria-label={`${totals.pending} pending`}>
              <b aria-hidden="true">{pending}</b> <span aria-hidden="true">pending</span>
            </span>
            <span className="ac-figure ac-figure-overdue" aria-label={`${totals.overdue} overdue`}>
              <b aria-hidden="true">{overdue}</b> <span aria-hidden="true">overdue</span>
            </span>
          </>
        ) : (
          <span className="ac-figure ac-figure-placeholder" aria-hidden="true">
            <b>–</b> pending
          </span>
        )}
      </div>
    </header>
  )
}

function BoardLoading({ roleName }) {
  const stages = expectedStages(roleName)
  return (
    <div className="ac-board" style={{ '--ac-cols': stages.length }} aria-busy="true">
      <span className="sr-only">Loading your Action Center</span>
      {stages.map((key) => <StageColumnPlaceholder key={key} stageKey={key} />)}
    </div>
  )
}

function AllCaughtUp() {
  return (
    <div className="ac-empty">
      <CheckCircle2 size={32} strokeWidth={1.75} aria-hidden="true" />
      <h2>All caught up</h2>
      <p>Nothing is waiting on you right now. New work appears here the moment it reaches you.</p>
    </div>
  )
}
