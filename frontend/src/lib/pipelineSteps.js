// The Health check → Drive test flow (UEP-14 §3.2): its steps, where each one
// lives, and how a URL names one.
//
// Health check: 1 Assign → 2 Checks. Ready goes on to Drive test Assign;
// Problematic goes to Remediation and comes back to Assign as a re-check.
// Drive test: 3 Assign → 4 Tests. Accept is DT done; Send back is Round 2 with
// the same contractor. The step lives in the URL (`?tab=`), so Back and
// Forward walk through it, and every older `?tab=` still lands somewhere.

/** @typedef {'hc'|'dt'} PipelinePage */

/**
 * @typedef {object} PipelineStep
 * @property {string} key        Step key.
 * @property {string} [queue]    The GET /me/home queue it is: the header leads with that count.
 * @property {PipelinePage} page The page that shows it.
 * @property {string} tab        Its `?tab=` on that page.
 * @property {string} name       The page heading.
 * @property {string} short      The step tile's label.
 * @property {number} [number]   Its place in the four steps.
 * @property {'hc'|'dt'|'exceptions'|'hidden'} band
 * @property {string} owner      The tile's owner line.
 * @property {string[]} count    Summary keys whose counts make the main figure.
 * @property {string[]} [decide] Summary keys whose counts make "N to decide".
 */

/** @type {readonly PipelineStep[]} In strip order: the arrow keys follow it. */
export const STEPS = Object.freeze([
  { key: 'hc_assign', queue: 'hc_assign', page: 'hc', tab: 'assign', number: 1, name: 'Health check · Assign', short: 'Assign', band: 'hc', owner: 'You', count: ['hc1'] },
  { key: 'hc_checks', queue: 'hc_review', page: 'hc', tab: 'checks', number: 2, name: 'Health check · Checks', short: 'Checks', band: 'hc', owner: 'Contractors, then you', count: ['hc2'], decide: ['hc3'] },
  { key: 'dt_assign', queue: 'dt_assign', page: 'dt', tab: 'assign', number: 3, name: 'Drive test · Assign', short: 'Assign', band: 'dt', owner: 'You', count: ['dt4'] },
  { key: 'dt_tests', queue: 'dt_review', page: 'dt', tab: 'tests', number: 4, name: 'Drive test · Tests', short: 'Tests', band: 'dt', owner: 'Contractors, then you', count: ['dt5', 'sent_back'], decide: ['dt6'] },
  { key: 'remediation', queue: 'hc_remediation', page: 'hc', tab: 'remediation', name: 'Exceptions · Remediation', short: 'Remediation', band: 'exceptions', owner: 'Owning teams', count: ['remediation'] },
  { key: 'done', page: 'dt', tab: 'done', name: 'DT done', short: 'DT done', band: 'exceptions', owner: 'On to acceptance', count: ['done'] },
  // Reachable by URL (Home's re-routes queue) but not drawn on the strip.
  { key: 'reroutes', queue: 'hc_reroutes', page: 'hc', tab: 'reroutes', name: 'Exceptions · Re-routes', short: 'Re-routes', band: 'hidden', owner: 'You', count: ['reroutes'] },
])

/** The steps drawn on the strip. */
export const STRIP_STEPS = STEPS.filter((s) => s.band !== 'hidden')

/** History is a view on either page, not a step on the strip. */
export const HISTORY_TAB = 'history'

export const PAGE_PATH = { hc: '/health-check', dt: '/drive-test' }

/** Each page's step when no tab is named. */
const DEFAULT_TAB = { hc: 'assign', dt: 'assign' }

/**
 * Superseded keys, so links people already hold keep working: the tab they
 * now open and, for the merged lists, the filter or tab inside it.
 */
const LEGACY_TABS = {
  hc: {
    pool: { tab: 'assign' },
    basket: { tab: 'assign' },
    running: { tab: 'checks' },
    review: { tab: 'checks', filter: 'to_decide' },
    results: { tab: 'checks', filter: 'to_decide' },
  },
  dt: {
    assignment: { tab: 'assign' },
    'in-progress': { tab: 'tests', view: 'with' },
    review: { tab: 'tests', view: 'review' },
    'sent-back': { tab: 'tests', view: 'with' },
  },
}

/** Tabs that moved to the other page: the answer is a different URL. */
const MOVED = {
  hc: { 'dt-assign': { tab: 'assign' }, 'dt-review': { tab: 'tests', view: 'review' } },
  dt: {},
}

/** The strip tab's element id, which the list card is labelled by. */
export const tabId = (key) => `pipeline-tab-${key}`

export const stepByKey = (key) => STEPS.find((s) => s.key === key)

/** The URL of a step: its page and `?tab=`. */
export function stepUrl(step) {
  return `${PAGE_PATH[step.page]}?tab=${step.tab}`
}

function withQuery(path, params, target) {
  const next = new URLSearchParams(params)
  next.set('tab', target.tab)
  if (target.filter) next.set('filter', target.filter)
  if (target.view) next.set('view', target.view)
  return `${path}?${next.toString()}`
}

/**
 * What a page shows for the `?tab=` it was handed:
 * `{ step }` for a pipeline step, `{ history: true }` for History, or
 * `{ redirect }` (a path with query) for a key that moved.
 * @param {PipelinePage} page
 * @param {string | null} requested
 * @param {URLSearchParams} [params] kept on a redirect
 */
export function resolveTab(page, requested, params = new URLSearchParams()) {
  const moved = MOVED[page][requested]
  if (moved) return { redirect: withQuery(PAGE_PATH.dt, params, moved) }
  const legacy = LEGACY_TABS[page][requested]
  if (legacy) return { redirect: withQuery(PAGE_PATH[page], params, legacy) }
  if (requested === HISTORY_TAB) return { history: true }
  const tab = requested || DEFAULT_TAB[page]
  const step = STEPS.find((s) => s.page === page && s.tab === tab)
  return { step: step || STEPS.find((s) => s.page === page && s.tab === DEFAULT_TAB[page]) }
}

const sum = (summary, keys) => (keys || []).reduce((n, k) => n + (summary?.[k]?.count ?? 0), 0)
const lateOf = (summary, keys) => (keys || []).reduce((n, k) => n + (summary?.[k]?.late ?? 0), 0)

/** A step's tile figures from GET /drive-test/pipeline/summary:
 * `{ count, decide, late, sla_days }`, or null while it loads. */
export function stepFigures(step, summary) {
  if (!summary) return null
  const keys = [...step.count, ...(step.decide || [])]
  if (!keys.some((k) => summary[k])) return null
  return {
    count: sum(summary, step.count),
    decide: step.decide ? sum(summary, step.decide) : null,
    late: lateOf(summary, keys),
    sla_days: summary[step.count[0]]?.sla_days ?? null,
  }
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Step 4, Tests: 263 sites, 12 to decide, 4 overdue, Contractors, then you" -- the tab's name. */
export function stepSpokenName(step, figures) {
  const head = step.number ? `Step ${step.number}, ${step.short}` : step.short
  if (!figures) return `${head}: loading`
  const parts = [plural(figures.count ?? 0, 'site')]
  if (figures.decide > 0) parts.push(`${figures.decide.toLocaleString('en-US')} to decide`)
  if (figures.late > 0) parts.push(`${figures.late.toLocaleString('en-US')} overdue`)
  parts.push(step.owner)
  return `${head}: ${parts.join(', ')}`
}
