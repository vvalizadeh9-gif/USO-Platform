/**
 * Explorer's addresses (UEP-11), built in one place so every link to a site
 * record or to the list agrees on the URL.
 */

export const EXPLORER_PATH = '/explorer'

/** The list, optionally searched, filtered or sorted (`q`, `province`, `type`,
 * `tech`, `dt_contractor`, `sort`, `dir`; see pages/explorer/listModel.js). */
export function explorerListPath(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ''),
  ).toString()
  return query ? `${EXPLORER_PATH}?${query}` : EXPLORER_PATH
}

/** One site's record page; `village` (a village code) highlights its row. */
export function siteRecordPath(workItemId, village) {
  const base = `${EXPLORER_PATH}/sites/${encodeURIComponent(workItemId)}`
  return village ? `${base}?village=${encodeURIComponent(village)}` : base
}

/** My Work narrowed to one site; `tab` picks the bucket it opens on. */
export function myWorkPath({ q, tab } = {}) {
  const query = new URLSearchParams(
    Object.entries({ tab, q }).filter(([, v]) => v != null && v !== ''),
  ).toString()
  return query ? `/my-work?${query}` : '/my-work'
}
