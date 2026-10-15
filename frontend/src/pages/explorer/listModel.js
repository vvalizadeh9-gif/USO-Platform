/**
 * Explorer's list (UEP-11a §B): its words, its URL and its memory, kept apart
 * from the components so they can be tested on their own.
 *
 * The URL is the list's state: search, filters and sort live in it, so a view
 * can be shared and Back restores it. Rows, totals and day counts are the
 * server's (GET /explorer/sites); nothing here recounts anything.
 */

export const PAGE_SIZE = 50

/** The columns that sort, in display order: key, header label, cell class. */
export const COLUMNS = Object.freeze([
  { key: 'site', label: 'Site' },
  { key: 'province', label: 'Province' },
  { key: 'type', label: 'Type' },
  { key: 'tech', label: 'Technology' },
  { key: 'villages', label: 'Villages' },
  { key: 'dt_contractor', label: 'DT contractor' },
])
const SORT_KEYS = new Set(COLUMNS.map((c) => c.key))

/**
 * The filter fields: label, URL parameter, the /filters key holding the
 * values, and how a value is named. Province and DT contractor travel as ids.
 */
export const FILTER_FIELDS = Object.freeze([
  { key: 'province', label: 'Province', optionsKey: 'provinces', byId: true, persian: true },
  { key: 'type', label: 'Site type', optionsKey: 'types' },
  { key: 'tech', label: 'Requested tech', optionsKey: 'technologies' },
  { key: 'dt_contractor', label: 'DT contractor', optionsKey: 'dt_contractors', byId: true, persian: true },
])

/** Every option of a field as { value, label }, values as URL strings. */
export function fieldOptions(field, options) {
  const list = options?.[field.optionsKey] || []
  return list.map((o) => (field.byId ? { value: String(o.id), label: o.name } : { value: o, label: o }))
}

/** What the URL asks the list for. Unknown sorts fall back to the default. */
export function readListState(params) {
  const sort = SORT_KEYS.has(params.get('sort')) ? params.get('sort') : 'site'
  const filters = {}
  for (const f of FILTER_FIELDS) {
    const value = params.get(f.key)
    if (value) filters[f.key] = value
  }
  return { q: params.get('q') || '', filters, sort, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' }
}

/** The state back as URL parameters, defaults left out so links stay short. */
export function listParams({ q, filters, sort, dir }) {
  const out = {}
  if (q) out.q = q
  for (const f of FILTER_FIELDS) if (filters[f.key]) out[f.key] = filters[f.key]
  if (sort !== 'site') out.sort = sort
  if (dir === 'desc') out.dir = 'desc'
  return out
}

/** The request parameters for GET /explorer/sites and its export. */
export const apiParams = (state) => ({ ...listParams(state), sort: state.sort, dir: state.dir })

/** Clicking a header: that column ascending, or the other way round if it already is. */
export function nextSort(state, key) {
  if (state.sort === key) return { sort: key, dir: state.dir === 'asc' ? 'desc' : 'asc' }
  return { sort: key, dir: 'asc' }
}

export const isFiltered = (state) => Boolean(state.q) || Object.keys(state.filters).length > 0

/** "New Site" reads "New site"; the row colours only a new site. */
export function typeLabel(type) {
  if (!type) return null
  const lower = type.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
export const isNewSite = (type) => (type || '').toLowerCase() === 'new site'

/**
 * `text` split around the first case-insensitive match of `term`, so the
 * match can be marked: [{ text, match }]. No term, no match: one plain part.
 */
export function splitMatch(text, term) {
  const value = text ?? ''
  const needle = (term || '').trim().toLowerCase()
  const at = needle ? value.toLowerCase().indexOf(needle) : -1
  if (at < 0) return [{ text: value, match: false }]
  return [
    { text: value.slice(0, at), match: false },
    { text: value.slice(at, at + needle.length), match: true },
    { text: value.slice(at + needle.length), match: false },
  ].filter((p) => p.text)
}

/** "Showing 50 of 4,201 sites" / "of 12 matching sites". */
export function footerText(shown, total, filtered) {
  const n = (v) => v.toLocaleString('en-US')
  const noun = filtered ? (total === 1 ? 'matching site' : 'matching sites') : total === 1 ? 'site' : 'sites'
  return { shown: n(shown), rest: `of ${n(total)} ${noun}` }
}

// --------------------------------------------------------------------------
// Coming back from a record page: the loaded pages and the scroll offset,
// kept for the view (the URL search) they belong to. One entry: the list the
// person just left, not a history of every list they have seen.
// --------------------------------------------------------------------------
// Kept briefly: long enough for a look at a record, not so long that a
// later visit opens on stale rows.
const KEEP_MS = 10 * 60 * 1000
let remembered = null

export function rememberList(search, snapshot, now = Date.now()) {
  remembered = { search, at: now, ...snapshot }
}

export function recallList(search, now = Date.now()) {
  if (!remembered || remembered.search !== search || now - remembered.at > KEEP_MS) return null
  return remembered
}

/** Where the record page's breadcrumb goes: the list as it was left. */
export function lastListSearch() {
  return remembered?.search || ''
}

export function forgetList() {
  remembered = null
}
