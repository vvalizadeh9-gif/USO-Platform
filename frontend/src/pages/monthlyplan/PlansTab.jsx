import { useState } from 'react'
import HistoryDrawer from './HistoryDrawer'
import { Avatar, PlanBar, PlanStatus, TabState } from './parts'
import { STREAMS, buildBoard, monthLabel, runningFigures } from './planBoard'
import { streamMeta } from './streams'

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))

/**
 * Plans: who shared a plan for the planning month and who did not, and how
 * each is doing against the month now running.
 *
 * The planned number and its status come from the planning month's queue;
 * the bar is the running month's delivered against its plan, from the
 * running month's overview. Read-only: decisions are taken on Approvals. A
 * row opens that contractor's plan history (every stream).
 *
 * One column per stream in STREAM_LIST, so the list fits two to four.
 */
export default function PlansTab({ board, running, planning, runningPeriod }) {
  const [history, setHistory] = useState(null)

  if (board.state !== 'ready') {
    return <TabState state={board.state} what="Plans" onRetry={board.reload} />
  }

  const view = buildBoard(board)
  const total = view.contractors.length
  const runningName = monthLabel(runningPeriod).split(' ')[0]

  return (
    <div className="mp-plans">
      <div className="mp-plans-head">
        <div>
          <h2 className="mp-h2">
            <span className="mp-fa">{monthLabel(planning)}</span> plans
          </h2>
          <span
            className="mp-segments"
            role="img"
            aria-label={`${view.shared.length} of ${total} contractors shared`}
          >
            {view.contractors.map((c) => (
              <i key={c.id} data-shared={c.shared} />
            ))}
          </span>
        </div>
        <p className="mp-plans-count tnum">
          <b>{view.shared.length}</b> of {total} contractors shared
        </p>
      </div>

      <div className="mp-list" style={{ '--mp-cols': STREAMS.length }}>
        <div className="mp-list-head" aria-hidden="true">
          <span>Contractor</span>
          {STREAMS.map((s) => (
            <span key={s}>{streamMeta(s).title}</span>
          ))}
        </div>
        <ul aria-label={`${monthLabel(planning)} plans`}>
          {view.shared.map((c) => (
            <li key={c.id} className="mp-row" data-contractor={c.id} onClick={() => setHistory(c)}>
              <span className="mp-who">
                <Avatar name={c.name} />
                <button
                  type="button"
                  className="mp-name mp-fa"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHistory(c)
                  }}
                >
                  {c.name}
                </button>
              </span>
              {STREAMS.map((stream) => (
                <StreamCell
                  key={stream}
                  stream={stream}
                  cell={c.cells[stream]}
                  run={runningFigures(running, stream, c.id)}
                  runningName={runningName}
                />
              ))}
            </li>
          ))}
        </ul>
      </div>

      {view.notShared.length > 0 && (
        <section className="mp-notshared" aria-labelledby="mp-notshared-label">
          <h3 id="mp-notshared-label">Not shared yet</h3>
          <ul>
            {view.notShared.map((c) => (
              <li key={c.id}>
                <Avatar name={c.name} muted size="sm" />
                <bdi className="mp-fa">{c.name}</bdi>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history && (
        <HistoryDrawer
          contractor={history}
          period={planning}
          label={monthLabel(planning)}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  )
}

function StreamCell({ stream, cell, run, runningName }) {
  const title = streamMeta(stream).title
  return (
    <span className="mp-cell" data-stream={stream}>
      <span className="mp-cell-top">
        <span className="mp-cell-number tnum">
          <span className="sr-only">{title} </span>
          {cell.state === 'none' ? '—' : fmt(cell.number)}
        </span>
        <PlanStatus state={cell.state} />
      </span>
      {run?.pip != null && (
        <>
          <PlanBar
            value={run.delivered}
            tick={run.pip}
            label={`${title}: ${fmt(run.delivered)} delivered of ${fmt(run.pip)} planned`}
          />
          <span className="mp-cell-foot tnum">
            <span>
              <bdi className="mp-fa">{runningName}</bdi> {fmt(run.delivered)} of {fmt(run.pip)}
            </span>
            {run.behind != null ? <span className="mp-alert">{run.behind} behind</span> : <span>On track</span>}
          </span>
        </>
      )}
    </span>
  )
}
