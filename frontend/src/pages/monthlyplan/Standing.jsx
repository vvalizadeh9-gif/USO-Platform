import { figure, sharePercent } from './figures'

/**
 * Where a month stands: Assignment, PIP, Delivered, and the calendar.
 *
 * Shared by both sides of the Monthly Plan, and shared on purpose. The
 * contractor reads it about themselves and the PM reads it about the
 * programme, but it is one question — how is the month now running going —
 * and two components answering it would be two chances to answer it
 * differently. The figures already come from one service; this is the same
 * argument applied to how they are drawn.
 *
 * The only thing that differs between the two readings is who the sentence is
 * about, which is what `subject` is for.
 */

/** One of the three figures, with its own name on it. */
export function FigureCard({ label, value, sub, highlight }) {
  return (
    <div className={`stat${highlight ? ' pip-stat-hl' : ''}`}>
      <div className="label">{label}</div>
      <div className="value tnum">{figure(value)}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/** The three cards, in the order they are read. */
export function FigureCards({ month }) {
  return (
    <div className="pip-trio">
      <FigureCard
        label="Assignment"
        value={month.assignment}
        sub={`${month.carried_in} carried in + ${month.newly_assigned} new`}
      />
      <FigureCard label="PIP" value={month.pip} sub="Approved for this month" />
      <FigureCard label="Delivered" value={month.delivered} sub="Drive tests done" highlight />
    </div>
  )
}

/**
 * Delivered against PIP, with the calendar marked on it.
 *
 * The marker is where delivery would be if it tracked the days, and the line
 * underneath says how far off that the reader is in drive tests rather than in
 * percentage points — "seven behind" is a number of days' work, and "eighteen
 * points behind" is not a number of anything.
 *
 * Pace decides nothing. A contractor who does the month's work in its first
 * week is not behind on day three, and nothing here treats them as though they
 * were.
 */
export function Standing({ month, subject = 'you' }) {
  const { pip, delivered, pace_pct: pace, label } = month
  const who = subject === 'programme' ? 'The programme is' : 'You are'

  if (pip == null) {
    return (
      <p className="muted pip-pacelbl">
        {subject === 'programme'
          ? `No PIP has been approved for ${label} by anybody, so there is nothing to measure the month's drive tests against yet.`
          : `No PIP has been approved for ${label}, so there is nothing to measure this month's drive tests against yet.`}
      </p>
    )
  }

  const percent = sharePercent(delivered, pip)
  const expected = Math.round((pip * pace) / 100)
  const gap = delivered - expected
  // A month whose days are done has no pace left to be ahead of.
  const running = pace < 100

  return (
    <div className="pip-standing">
      <div className="pip-standtop">
        <span>Delivered against PIP</span>
        <span>
          <b className="tnum">{delivered}</b> of {pip}
          {percent == null ? '' : ` · ${percent}%`}
        </span>
      </div>
      <div className="pip-trackwrap">
        <div className="pip-track">
          {/* Capped at the track's width so a month that passed its target
              draws full rather than past the end of the card; the figures
              above say by how much. */}
          <i style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
        </div>
        {running && (
          <span className="pip-pace" style={{ left: `${pace}%` }} data-testid="pip-pace" />
        )}
      </div>
      <p className="pip-pacelbl">
        {running
          ? `Marker at ${Math.round(pace)}% — where you would be if delivery tracked the calendar. `
          : 'The month is over. '}
        {gap === 0
          ? running
            ? `${who} exactly on that pace.`
            : `${who} level with the calendar.`
          : `${who} ${Math.abs(gap)} drive test${Math.abs(gap) === 1 ? '' : 's'} ${
              gap > 0 ? 'ahead of' : 'behind'
            } that pace.`}
      </p>
    </div>
  )
}
