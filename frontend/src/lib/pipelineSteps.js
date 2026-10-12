// The Health check → Drive test pipeline: its steps, where each one lives, and
// how a URL names one (UEP-06 §1).
//
// Both work pages show the same strip. The step decides which page and which
// list you see, and the step lives in the URL (`?tab=`), so Back and Forward
// walk through it and every link people already hold keeps working.

/** @typedef {'hc'|'dt'} PipelinePage */

/**
 * @typedef {object} PipelineStep
 * @property {string} key        The summary key (GET /drive-test/pipeline/summary).
 * @property {PipelinePage} page The page that shows it.
 * @property {string} tab        Its `?tab=` on that page.
 * @property {string} name       The page heading.
 * @property {string} short      The strip tile's label.
 * @property {number} [number]   Its place in the six steps; none for the rest.
 * @property {'hc'|'dt'|'outcome'|'loop'} group
 * @property {string} owner      Who holds its items, for the tab's spoken name.
 */

/** @type {readonly PipelineStep[]} In strip order: the arrow keys follow it. */
export const STEPS = Object.freeze([
  { key: 'hc1', page: 'hc', tab: 'pool', number: 1, name: 'Assign health check', short: 'To assign', group: 'hc', owner: 'waiting on you' },
  { key: 'hc2', page: 'hc', tab: 'running', number: 2, name: 'In health check', short: 'In check', group: 'hc', owner: 'with health-check contractors' },
  { key: 'hc3', page: 'hc', tab: 'review', number: 3, name: 'Review results', short: 'To review', group: 'hc', owner: 'waiting on you' },
  { key: 'dt4', page: 'dt', tab: 'assignment', number: 4, name: 'Assign drive test', short: 'To assign', group: 'dt', owner: 'waiting on you' },
  { key: 'dt5', page: 'dt', tab: 'in-progress', number: 5, name: 'With contractor', short: 'In test', group: 'dt', owner: 'with contractors' },
  { key: 'dt6', page: 'dt', tab: 'review', number: 6, name: 'Review drive test', short: 'To review', group: 'dt', owner: 'waiting on you' },
  { key: 'done', page: 'dt', tab: 'done', name: 'DT done', short: 'DT done', group: 'outcome', owner: 'on to acceptance' },
  { key: 'remediation', page: 'hc', tab: 'remediation', name: 'Remediation', short: 'Remediation', group: 'loop', owner: 'with the owning teams' },
  { key: 'reroutes', page: 'hc', tab: 'reroutes', name: 'Re-routes', short: 'Re-routes', group: 'loop', owner: 'waiting on you' },
  { key: 'sent_back', page: 'dt', tab: 'sent-back', name: 'Sent back', short: 'Sent back', group: 'loop', owner: 'with contractors' },
])

/** History is a view on either page, not a step on the strip. */
export const HISTORY_TAB = 'history'

export const PAGE_PATH = { hc: '/health-check', dt: '/drive-test' }

/** Each page's step when no tab is named. */
const DEFAULT_TAB = { hc: 'pool', dt: 'assignment' }

/** Superseded keys, kept so links people already hold keep working. */
const LEGACY_TABS = { hc: { basket: 'pool', results: 'review' }, dt: {} }

/** Tabs that moved to the other page: the answer is a different URL. */
const MOVED = { hc: { 'dt-assign': 'assignment', 'dt-review': 'review' }, dt: {} }

/** The strip tab's element id, which the list card is labelled by. */
export const tabId = (key) => `pipeline-tab-${key}`

export const stepByKey = (key) => STEPS.find((s) => s.key === key)

/** The URL of a step: its page and `?tab=`. */
export function stepUrl(step) {
  return `${PAGE_PATH[step.page]}?tab=${step.tab}`
}

/**
 * What a page shows for the `?tab=` it was handed:
 * `{ step }` for a pipeline step, `{ history: true }` for History, or
 * `{ redirect }` (a path with query) for a key that now lives on the other page.
 * @param {PipelinePage} page
 * @param {string | null} requested
 * @param {URLSearchParams} [params] kept on a redirect
 */
export function resolveTab(page, requested, params = new URLSearchParams()) {
  const moved = MOVED[page][requested]
  if (moved) {
    const next = new URLSearchParams(params)
    next.set('tab', moved)
    return { redirect: `${PAGE_PATH.dt}?${next.toString()}` }
  }
  if (requested === HISTORY_TAB) return { history: true }
  const tab = LEGACY_TABS[page][requested] || requested || DEFAULT_TAB[page]
  const step = STEPS.find((s) => s.page === page && s.tab === tab)
  return { step: step || STEPS.find((s) => s.page === page && s.tab === DEFAULT_TAB[page]) }
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Step 5, In test: 263 sites, 4 late, with contractors" -- the tab's name. */
export function stepSpokenName(step, figures) {
  const head = step.number ? `Step ${step.number}, ${step.short}` : step.short
  if (!figures) return `${head}: loading`
  const parts = [plural(figures.count ?? 0, 'site')]
  if (figures.late > 0) parts.push(`${figures.late.toLocaleString('en-US')} late`)
  parts.push(step.owner)
  return `${head}: ${parts.join(', ')}`
}

/** Volume bar widths: each step's count over the largest of the six, as a
 * percentage, never under 3% so an empty step still shows its track's start. */
export function volumeWidths(summary) {
  const six = STEPS.filter((s) => s.number).map((s) => summary?.[s.key]?.count ?? 0)
  const max = Math.max(1, ...six)
  return Object.fromEntries(
    STEPS.filter((s) => s.number).map((s) => [s.key, Math.max(3, (100 * (summary?.[s.key]?.count ?? 0)) / max)]),
  )
}
