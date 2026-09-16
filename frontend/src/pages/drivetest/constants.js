// Names, shapes and colours the dashboard shares with the backend.
//
// The stage strings must match `services/workflow.py` exactly — they travel
// in URLs to the work queue, which compares them to `WorkItem.current_stage`.
// A drifted spelling here produces an empty list rather than an error, so
// they are named constants in one file instead of literals in six.

export const STAGE_PROBLEMATIC = 'Problematic'
export const STAGE_DT_DONE = 'DT Done'

/** The three states an on-air site can be in, and the one colour each gets.
 *
 * THE WHOLE COLOUR RULE OF THIS PAGE IS HERE. Colour on this dashboard means
 * a state and nothing else: green is a finished drive test, indigo is work in
 * flight, red is a problem. Nothing else on the page is allowed to be any of
 * those three hues, which is why the brand teal — the nav-active colour and
 * the primary button — appears nowhere in a chart. The page it replaces drew
 * ongoing in that same teal, plan in violet and waiting in amber, so five
 * hues competed and none of them meant anything in particular.
 *
 * Amber is deliberately not among them. It is the obvious pick for "in
 * progress", and it fails: against this red it is 3.4 ΔE apart under deutan
 * and 12 under normal vision, which is to say a red-green reader cannot tell
 * an ongoing site from a problematic one. Indigo clears both at 20+.
 */
export const STATE_COLOR = {
  done: 'var(--dt-done)',
  ongoing: 'var(--dt-ongoing)',
  problematic: 'var(--dt-problem)',
}

/** The ordinal ramp for the ongoing age bands.
 *
 * One hue, light to dark, because the bands are an ordered scale: the longer
 * a site has been held, the heavier its bar reads. This is the one place a
 * ramp is allowed — the contractor and province splits are nominal
 * categories, and shading those by size would colour a bar by the length it
 * already has.
 */
export const AGE_RAMP = [
  'var(--dt-age-1)',
  'var(--dt-age-2)',
  'var(--dt-age-3)',
  'var(--dt-age-4)',
  'var(--dt-age-5)',
  'var(--dt-age-6)',
]

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
  { key: 'remaining', label: 'Remaining', color: STATE_COLOR.ongoing },
  { key: 'dt_done', label: 'Drive tests done', color: STATE_COLOR.done },
  { key: 'problematic', label: 'Problematic', color: STATE_COLOR.problematic },
]

/** The buckets `GET /drive-test/sites` accepts, and how each reads in words.
 *
 * The words are the page title: "64 problematic sites", not "bucket:
 * problematic". A reader arriving from a number should see that number named
 * back to them in the language the dashboard used.
 */
export const BUCKET_LABEL = {
  onair: 'on-air sites',
  done: 'sites with their drive test done',
  ongoing: 'ongoing sites',
  problematic: 'problematic sites',
  remaining: 'remaining sites',
  delivered: 'drive tests delivered',
}

/** The value the endpoint uses for sites no contractor can be tied to. */
export const UNATTRIBUTED = 'none'

/** Rows per page on the site list. */
export const PAGE_SIZE = 100
