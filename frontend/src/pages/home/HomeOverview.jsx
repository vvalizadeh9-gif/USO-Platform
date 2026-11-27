import Icon from '../../components/Icon'
import { formatNumber } from '../../lib/numbers'
import { WAITING, changeOf, legendParts, todoParts } from './homeLogic'
import useCountUp from './useCountUp'

/** "▲ 12 vs 7 days ago", red only when it went the wrong way. */
function Change({ change, testId }) {
  if (!change) return null
  return (
    <span className="ho-change" data-worse={change.worse || undefined} data-testid={testId}>
      {change.dir && <Icon name={change.dir === 'up' ? 'caret--up' : 'caret--down'} size={16} />}
      {change.text}
    </span>
  )
}

/** The To do bar: one button per status, sized by its count, for the mouse.
 * A small part can be a few pixels wide, so keyboard and screen-reader users
 * get the legend below -- the same control at a full target size (WCAG 2.5.8,
 * "equivalent") -- and the bar stays out of the tab order and the a11y tree. */
function TodoBar({ parts, filter, onFilter }) {
  return (
    <div className="ho-bar" aria-hidden="true" data-testid="todo-bar">
      {parts.map((p, i) => (
        <button
          key={p.key}
          type="button"
          tabIndex={-1}
          className={`ho-seg ${p.cls}${filter === p.key ? ' is-on' : ''}`}
          style={{ flexGrow: p.count, '--i': i }}
          data-status={p.key}
          title={`${p.label}: ${formatNumber(p.count)}`}
          onClick={() => onFilter(p.key)}
        />
      ))}
    </div>
  )
}

function Legend({ parts, filter, onFilter }) {
  return (
    <div className="ho-legend">
      {parts.map((p, i) => (
        <button
          key={p.key}
          type="button"
          aria-label={`${p.label}: ${formatNumber(p.count)}, show only these`}
          className="ho-lg"
          style={{ '--i': i }}
          data-status={p.key}
          aria-pressed={filter === p.key}
          onClick={() => onFilter(p.key)}
        >
          <i className={`ho-swatch ${p.cls}`} aria-hidden="true" />
          <b>{formatNumber(p.count)}</b>
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Home's overview card (UEP-27 §4.1): To do with its stacked bar and legend,
 * Waiting on others, and Done this week.
 *
 * The bar's parts, the legend and Waiting on others filter the work cards
 * (`onFilter`, a toggle); the To do and Done figures open their lists
 * (`onOpen('todo' | 'done', element)`).
 */
export default function HomeOverview({ totals, filter, onFilter, onOpen }) {
  const todo = useCountUp(totals.todo || 0)
  const waiting = useCountUp(totals.waiting || 0)
  const parts = todoParts(totals)
  const doneWeek = totals.done_this_week
  const hasDone = doneWeek !== null && doneWeek !== undefined
  const empty = !totals.todo
  return (
    <section className={`ho-card${filter ? ' is-filtering' : ''}`} aria-label="Your numbers">
      <div className="ho-todo" title="Items where you are the next person to act">
        <span className="ho-label">To do</span>
        <button
          type="button"
          className="ho-num ho-big"
          data-testid="todo-number"
          aria-label={`To do: ${formatNumber(totals.todo || 0)}, show list`}
          onClick={(e) => onOpen('todo', e.currentTarget)}
        >
          {formatNumber(todo)}
        </button>
        {/* All caught up with no snapshot yet still reads "No change". */}
        <Change change={changeOf(totals.todo_change_7d ?? (empty ? 0 : null))} testId="todo-change" />
      </div>

      <div className="ho-split">
        <TodoBar parts={parts} filter={filter} onFilter={onFilter} />
        <Legend parts={legendParts(totals)} filter={filter} onFilter={onFilter} />
      </div>

      <button
        type="button"
        className="ho-side ho-waiting"
        title="Items others hold that you chase"
        data-testid="waiting"
        aria-pressed={filter === WAITING}
        aria-label={`Waiting on others: ${formatNumber(totals.waiting || 0)}, show only these`}
        onClick={() => onFilter(WAITING)}
      >
        <span className="ho-label">Waiting on others</span>
        <span className="ho-mid">{formatNumber(waiting)}</span>
        <small>
          {totals.waiting
            ? `${formatNumber(totals.waiting_late || 0)} late, ${formatNumber(totals.waiting_no_date || 0)} no date`
            : 'Nothing with others'}
        </small>
      </button>

      {hasDone && (
        <div className="ho-side">
          <span className="ho-label">Done this week</span>
          <button
            type="button"
            className="ho-num ho-mid"
            data-testid="done-number"
            aria-label={`Done this week: ${formatNumber(doneWeek)}, show list`}
            onClick={(e) => onOpen('done', e.currentTarget)}
          >
            {formatNumber(doneWeek)}
          </button>
          {totals.done_last_week == null
            ? <small>Since Saturday</small>
            : <Change change={changeOf(doneWeek - totals.done_last_week, { vs: 'vs last week', upIsWorse: false })} />}
        </div>
      )}
    </section>
  )
}

/** The overview while Home loads: the same frame, grey blocks. */
export function OverviewSkeleton() {
  return (
    <div className="ho-card" aria-hidden="true" data-testid="overview-skeleton">
      <div><span className="h-skel" style={{ width: 80, height: 14 }} /><span className="h-skel" style={{ width: 96, height: 36, marginTop: 6 }} /></div>
      <div><span className="h-skel" style={{ height: 14, borderRadius: 7 }} /><span className="h-skel" style={{ width: '70%', height: 14, marginTop: 12 }} /></div>
      <div className="ho-side"><span className="h-skel" style={{ width: 96, height: 14 }} /><span className="h-skel" style={{ width: 48, height: 28, marginTop: 6 }} /></div>
      <div className="ho-side"><span className="h-skel" style={{ width: 96, height: 14 }} /><span className="h-skel" style={{ width: 48, height: 28, marginTop: 6 }} /></div>
    </div>
  )
}
