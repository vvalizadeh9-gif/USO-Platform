// Names and shapes the dashboard shares with the backend.
//
// The stage strings must match `services/workflow.py` exactly — they travel
// in URLs to the work queue, which compares them to `WorkItem.current_stage`.
// A drifted spelling here produces an empty list rather than an error, so
// they are named constants in one file instead of literals in six.

export const STAGE_PROBLEMATIC = 'Problematic'
export const STAGE_DT_DONE = 'DT Done'

/** Which way "good" points for each KPI, for delta colouring.
 *
 * Three of these count work you want to see fall. See `format.deltaTone` for
 * why the dashboard this replaces got them all backwards.
 */
export const KPI_DIRECTION = {
  total_onair: 'up',
  total_dt_done: 'up',
  current_month_dt_done: 'up',
  total_remaining: 'down',
  total_ongoing: 'down',
  total_problematic: 'down',
}

/** How many rows a collapsed province view shows before folding the rest. */
export const PROVINCE_LIMIT = 6

/** Which series the trend chart can draw, and how each is labelled and drawn.
 *
 * `remaining` leads because it is the figure the programme is actually
 * managing down; `dt_done` is its mirror and rises. Problematic is separated
 * out because it is an order of magnitude smaller and would be a flat line
 * against the other two on a shared axis.
 */
export const TREND_SERIES = [
  { key: 'remaining', label: 'Remaining', color: 'var(--amber)' },
  { key: 'dt_done', label: 'Drive tests done', color: 'var(--green)' },
  { key: 'problematic', label: 'Problematic', color: 'var(--red)' },
]
