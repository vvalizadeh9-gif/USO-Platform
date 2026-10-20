// Admin > Province assignments (UEP-17): the page's pure logic -- owners with
// unsaved edits applied, the counts they imply, and the words the page says.
import { coordinatorColors } from '../../design/tokens'

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function formatDate(at) {
  if (!at) return ''
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatWhen(at) {
  if (!at) return ''
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export const errorText = (err) => {
  const d = err?.response?.data?.detail
  if (typeof d === 'string') return d
  if (d?.message) return d.message
  return 'Please try again.'
}

export const colourOf = (coordinator) => coordinatorColors[coordinator.colour_index % coordinatorColors.length]

/** Each region's owner with the unsaved edits applied. */
export function effectiveOwners(regions, draft) {
  const out = {}
  for (const r of regions) out[r.name] = draft[r.name] ?? r.coordinator_user_id
  return out
}

/** The regions whose owner differs from the saved one. */
export const changedRegions = (regions, draft) =>
  regions.filter((r) => draft[r.name] != null && draft[r.name] !== r.coordinator_user_id)

/** Regions and provinces per coordinator, from the owners on screen. */
export function loadFor(regions, owners) {
  const load = {}
  for (const r of regions) {
    const id = owners[r.name]
    if (id == null) continue
    load[id] ??= { regions: 0, provinces: 0 }
    load[id].regions += 1
    load[id].provinces += r.provinces.length
  }
  return load
}

/** The 409 message: which edits survived the reload. */
export function conflictText(kept) {
  const base = 'Assignments changed since you opened the page.'
  return kept.length
    ? `${base} Your edits to ${kept.join(', ')} were kept; others were refreshed.`
    : `${base} The latest values are loaded.`
}

const nameOr = (name) => name ?? 'No coordinator'

export function historyLine(change) {
  const head = `${change.cra_region} (${plural(change.provinces, 'province')})`
  if (change.old === change.new) return `${head}: ${nameOr(change.new)}`
  return `${head}: ${nameOr(change.old)} → ${nameOr(change.new)}`
}
