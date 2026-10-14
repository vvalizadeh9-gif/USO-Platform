// The header search, minus the React: what is asked, what comes back, and the
// order a keyboard walks through it.
//
// Two sources answer one box. The server knows the data (sites, villages,
// contractors, people) and scopes it to what the signed-in person may open; the
// browser knows the interface (the apps and pages this role has). They are
// merged here into one list of groups, so the component only draws and the
// rules can be tested without a DOM.

import { appRoute, appState } from './appRegistry'

/** Shorter than this finds half the database and says nothing. The server
 *  agrees (services/global_search.MIN_QUERY_LENGTH). */
export const MIN_QUERY_LENGTH = 2

/** How many pages and apps to offer; the rest are one more letter away. */
export const MAX_PAGE_HITS = 6

/** Where "see all" goes for a group that has more matches than it shows. */
const SEE_ALL = {
  sites: (q) => `/work-items?q=${encodeURIComponent(q)}`,
  villages: (q) => `/work-items?q=${encodeURIComponent(q)}`,
  people: (q) => `/admin?tab=users&q=${encodeURIComponent(q)}`,
}

/** The query as it is compared: trimmed, lower-cased. */
export const normaliseQuery = (q) => (q || '').trim()

/** Whether the box holds something worth sending. */
export const isSearchable = (q) => normaliseQuery(q).length >= MIN_QUERY_LENGTH

/**
 * The apps and pages of this role that match `term`, by name or description.
 *
 * Page results read "Page · App" so "Lifecycle gaps" says it lives in
 * Insights. An app whose own name matches is offered once, ahead of its pages.
 */
export function searchPages(apps, term) {
  const needle = normaliseQuery(term).toLowerCase()
  if (needle.length < MIN_QUERY_LENGTH) return []
  const hits = []
  for (const app of apps) {
    if (app.name.toLowerCase().includes(needle) || (app.description || '').toLowerCase().includes(needle)) {
      hits.push({
        id: `app:${app.id}`,
        title: app.name,
        subtitle: app.description || 'App',
        route: appRoute(app),
        state: appState(app),
      })
    }
    for (const page of app.pages) {
      if (!page.label.toLowerCase().includes(needle)) continue
      hits.push({
        id: `page:${app.id}:${page.id}`,
        title: page.label,
        subtitle: app.name,
        route: page.route,
        state: appState(app),
      })
    }
  }
  return hits.slice(0, MAX_PAGE_HITS)
}

/**
 * One list of groups to draw: the interface's own pages first (the fastest way
 * anywhere is a page name), then what the server found.
 *
 * Every group carries `seeAll`, the address of the full list when the server
 * has more matches than it returned and a page exists for them.
 */
export function buildGroups(apps, term, serverGroups = []) {
  const q = normaliseQuery(term)
  const groups = []
  const pages = searchPages(apps, q)
  if (pages.length) groups.push({ key: 'pages', label: 'Pages and apps', total: pages.length, items: pages, seeAll: null })
  for (const g of serverGroups) {
    const more = g.total > g.items.length && SEE_ALL[g.key]
    groups.push({
      key: g.key,
      label: g.label,
      total: g.total,
      items: g.items.map((item) => ({ ...item, id: `${g.key}:${item.id}` })),
      seeAll: more ? SEE_ALL[g.key](q) : null,
    })
  }
  return groups
}

/**
 * The rows a keyboard walks through, top to bottom: every result, and each
 * group's "see all" row after its results. Each row knows where it goes.
 */
export function flattenRows(groups) {
  const rows = []
  for (const g of groups) {
    for (const item of g.items) rows.push({ id: item.id, route: item.route, state: item.state, kind: 'result' })
    if (g.seeAll) rows.push({ id: `${g.key}:all`, route: g.seeAll, kind: 'all' })
  }
  return rows
}

/** Where Enter goes with nothing highlighted: the first result, else the full
 *  site search -- the box has always meant "find a site" and still does. */
export function fallbackRoute(rows, term) {
  if (rows.length) return { route: rows[0].route, state: rows[0].state }
  return { route: `/work-items?q=${encodeURIComponent(normaliseQuery(term))}`, state: undefined }
}

/** The step in a list of `count` rows from `index` (-1 for none), wrapping. */
export function stepIndex(index, count, direction) {
  if (count === 0) return -1
  if (index < 0) return direction > 0 ? 0 : count - 1
  return (index + direction + count) % count
}
