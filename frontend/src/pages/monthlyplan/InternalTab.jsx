import Icon from '../../components/Icon'
import { signedNumber } from './history'
import MeasureList from './MeasureList'
import { Chip, TabState } from './parts'
import { BAND_STREAMS, BAND_TITLE, monthLabel } from './planBoard'
import Stepper from './Stepper'

/**
 * Internal PIP: MTN's own monthly target per stream, for the planning month or
 * the running one, against what the contractors' approved plans cover.
 *
 * Two stacked bands, DT delivery and Acceptance. Each shows the target, how
 * much of it the approved contractor plans cover, and a card with the number
 * to move (− / + only) beside last month's. Edits are held by
 * useInternalTargets; the page header saves or discards them all at once.
 * A role that cannot set targets reads the same numbers as text.
 *
 * The target is one number per stream and month on the server, so each band
 * has one card, not one per coordinator.
 *
 * Coverage is summed from the queue the Plans page already holds (each
 * contractor's approved plan in force), so this page reads nothing slow.
 */
export default function InternalTab({ month, onMonth, targets, board, periods, canSetTarget }) {
  const ready = targets.state === 'ready' && board.state === 'ready'

  const rows = [
    { key: 'planning', name: monthLabel(periods.planning), fa: true, tag: 'Planning' },
    { key: 'running', name: monthLabel(periods.running), fa: true, tag: 'Running' },
  ]

  return (
    <div className="mp2-page">
      <div className="mp2-split mp2-split-full">
        <MeasureList
          label="Months"
          groups={[{ key: 'month', title: 'Month', icon: 'calendar', rows }]}
          value={month}
          onChange={onMonth}
        />
        {!ready ? (
          <section className="mp2-card mp2-detail">
            <TabState
              state={targets.state !== 'ready' ? targets.state : board.state}
              what="Internal PIP"
              onRetry={() => {
                targets.reload()
                board.reload()
              }}
            />
          </section>
        ) : (
          <section className="mp2-card mp2-detail" aria-label={`Internal PIP, ${monthLabel(periods[month])}`} key={month}>
            <header className="mp2-detail-head">
              <span className="mp2-avatar" aria-hidden="true">
                <Icon name="meter" size={22} />
              </span>
              <div className="mp2-detail-who">
                <h2>Internal PIP</h2>
                <p className="mp-fa">{monthLabel(periods[month])}</p>
              </div>
            </header>
            <div className="mp2-bands">
              {BAND_STREAMS.map((stream) => (
                <TargetBand
                  key={stream}
                  stream={stream}
                  month={month}
                  targets={targets}
                  covered={covered(board[month], stream)}
                  canSetTarget={canSetTarget}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** The contractors' approved plans in force for one stream of one month. */
function covered(queues, stream) {
  return (queues?.[stream]?.rows ?? []).reduce((sum, r) => sum + (r.in_force_count ?? 0), 0)
}

function TargetBand({ stream, month, targets, covered, canSetTarget }) {
  const title = BAND_TITLE[stream]
  const total = targets.value(month, stream)
  const last = targets.previous(month, stream)
  const changed = targets.changed(month, stream)
  const toCover = total - covered
  const scale = Math.max(total, covered, 1)

  return (
    <section className="mp2-band mp2-band-target" aria-label={title}>
      <div className="mp2-target-head">
        <h2>{title}</h2>
        <span className="mp2-total tnum">{total}</span>
        <div
          className="mp2-cover"
          role="img"
          aria-label={`${title}: ${covered} of ${total} covered by approved contractor plans`}
        >
          <i className="mp2-cover-done" style={{ width: `${(100 * Math.min(covered, total)) / scale}%` }} />
          {total > covered && <i className="mp2-cover-rest" style={{ left: `${(100 * covered) / scale}%`, width: `${(100 * (total - covered)) / scale}%` }} />}
        </div>
        <Chip>{covered} in contractor plans</Chip>
        {toCover > 0 ? <Chip tone="danger">{toCover} to cover</Chip> : toCover === 0 ? <Chip>Covered</Chip> : <Chip tone="accent">{-toCover} over</Chip>}
      </div>

      <div className="mp2-cards">
        <article className="mp2-pcard" data-changed={changed || undefined}>
          <header>
            <span className="mp2-avatar mp2-avatar-sm" aria-hidden="true">
              <Icon name="meter" size={16} />
            </span>
            <h3>MTN Internal PIP</h3>
          </header>
          {canSetTarget ? (
            <Stepper
              size="target"
              value={total}
              changed={changed}
              disabled={targets.saving}
              label={`${title} Internal PIP`}
              onChange={(n) => targets.setDraft(month, stream, n)}
            />
          ) : (
            <span className="mp2-big tnum" role="status" aria-label={`${title} Internal PIP`}>{total}</span>
          )}
          <footer>
            <span className="tnum">Last month {last ?? '—'}</span>
            {last != null && (total === last ? <Chip>Same</Chip> : <Chip tone="accent">{signedNumber(total - last)}</Chip>)}
          </footer>
        </article>
      </div>
    </section>
  )
}
