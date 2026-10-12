import { useEffect, useState } from 'react'
import Icon from '../Icon'
import { canUndo, secondsLeft, useActionLog } from '../../lib/actionLog'
import { WorkListCard } from './parts'
import { useWork } from './WorkContext'

const time = (at) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at)

/** Re-render every second while anything can still be undone. */
function useTick(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/**
 * History (UEP-06 §6): your recent assignments and confirmations, each with
 * Undo and the seconds left on it, then "Can no longer be undone" or
 * "Undone".
 */
export default function RecentActions({ panelProps, extra }) {
  const actions = useActionLog()
  const { undo } = useWork()
  const now = useTick(actions.some((a) => canUndo(a)))

  return (
    <WorkListCard
      {...panelProps}
      tools={extra?.tools ?? <b className="uw-card-title">History</b>}
      description="Your recent actions. Each one can be undone for 2 minutes."
    >
      {extra?.body ?? (
        actions.length === 0 ? (
          <div className="uw-state">
            <span className="uw-state-icon"><Icon name="recently-viewed" size={20} /></span>
            <b>No actions yet</b>
            <span>Assignments and confirmations you make appear here.</span>
          </div>
        ) : (
          <table className="uw-table" aria-label="Your recent actions">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Undo</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="uw-num">{time(a.at)}</td>
                  <td>{a.label}</td>
                  <td>
                    {a.status === 'undone' ? (
                      <span className="uw-muted">Undone</span>
                    ) : canUndo(a, now) ? (
                      <span className="uw-undo-cell">
                        <button type="button" className="uw-btn uw-btn-sm" onClick={() => undo(a)}>
                          <Icon name="undo" size={16} /> Undo
                        </button>
                        <span className="uw-muted">{secondsLeft(a, now)} s left</span>
                      </span>
                    ) : (
                      <span className="uw-muted">Can no longer be undone</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </WorkListCard>
  )
}
