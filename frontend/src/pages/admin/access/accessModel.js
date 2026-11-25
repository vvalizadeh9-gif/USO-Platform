/**
 * Admin › Access: the rules the screen follows, kept apart from the markup so
 * they are tested on their own (UEP-25).
 */
import { APPS } from '../../../shell/appRegistry'

/** The catalogue's apps, in launcher order, each with its launcher tile. */
const APP_TILE = {
  'Drive test': 'drive-test',
  Acceptance: 'acceptance',
  Explorer: 'explorer',
  Insights: 'insights',
  Planning: 'monthly-plan',
  Admin: 'admin',
}
const APP_ORDER = ['Explorer', 'Drive test', 'Acceptance', 'Planning', 'Insights', 'Admin']

export const LEVEL_LABEL = { none: 'None', view: 'View', edit: 'Edit' }

export const DATA_SCOPES = [
  { value: 'all', label: 'All data' },
  { value: 'provinces', label: 'Provinces' },
  { value: 'cra_regions', label: 'CRA regions' },
  { value: 'contractor', label: 'Contractor company' },
  { value: 'team_basket', label: 'Team basket' },
  { value: 'none', label: 'No data area' },
]

export const LANDINGS = [
  { value: 'standard', label: 'Home' },
  { value: 'region', label: 'Region home' },
  { value: 'work', label: 'Work home' },
  { value: '/explorer', label: 'Explorer' },
  { value: '/reports/drive-test', label: 'Drive test dashboard' },
  { value: '/reports/kpi', label: 'Roles performance' },
  { value: '/admin', label: 'Admin' },
]

/** The registry app (for its colour tile and icon) behind a catalogue app. */
export function appFor(appName) {
  return APPS.find((a) => a.id === APP_TILE[appName]) || null
}

/** Features grouped by app, apps in launcher order, features by sort_order. */
export function groupFeatures(features) {
  const groups = new Map()
  for (const f of [...features].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!groups.has(f.app)) groups.set(f.app, [])
    groups.get(f.app).push(f)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => APP_ORDER.indexOf(a) - APP_ORDER.indexOf(b))
    .map(([app, items]) => ({ app, tile: appFor(app), features: items }))
}

/** The levels a feature offers, None first. */
export function levelsOf(feature) {
  return ['none', ...(feature.levels || [])]
}

/** What changed between two {feature: level} maps ('none' or absent = no access). */
export function diffGrants(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  const changes = []
  for (const key of keys) {
    const from = before?.[key] || 'none'
    const to = after?.[key] || 'none'
    if (from !== to) changes.push({ key, from, to })
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key))
}

/** The PUT body: only what changes, 'none' for a removal. */
export function grantsPayload(changes) {
  return Object.fromEntries(changes.map((c) => [c.key, c.to]))
}

/** "Coordinator: +Explorer (View), −Exports. Affects 4 users." */
export function saveSummary(roleName, changes, features, userCount, settingsChanged = false) {
  const label = (key) => features.find((f) => f.key === key)?.label || key
  const parts = changes.map((c) => {
    if (c.to === 'none') return `−${label(c.key)}`
    if (c.from === 'none') return `+${label(c.key)} (${LEVEL_LABEL[c.to]})`
    return `${label(c.key)} ${LEVEL_LABEL[c.from]} → ${LEVEL_LABEL[c.to]}`
  })
  if (settingsChanged) parts.push('settings')
  const users = `Affects ${userCount} user${userCount === 1 ? '' : 's'}.`
  return `${roleName}: ${parts.join(', ') || 'no changes'}. ${users}`
}

/** The user access a role would give, for "View as" and the launcher preview. */
export function accessFromGrants(role, grants) {
  const features = Object.fromEntries(Object.entries(grants).filter(([, lv]) => lv && lv !== 'none'))
  return {
    features,
    hidden_in_menus: role.hidden_in_menus || [],
    exceptions: [],
    landing: role.landing,
    role: role.name,
    data_scope_type: role.data_scope_type,
  }
}

/** A History entry in one line: what, before → after. */
export function describeHistory(entry) {
  const b = entry.before || {}
  const a = entry.after || {}
  switch (entry.action) {
    case 'access.role_created':
      return `Created role ${a.role}${a.copied_from ? ` from ${a.copied_from}` : ''}`
    case 'access.role_deleted':
      return `Deleted role ${b.role}`
    case 'access.role_grant_changed': {
      const changes = diffGrants(b.grants, a.grants)
      const text = changes.map((c) => `${c.key} ${c.from} → ${c.to}`).join(', ')
      return `${a.role}: ${text || 'settings changed'}`
    }
    case 'access.user_override_changed':
      return `${a.user || b.user}: ${a.feature || b.feature} ${b.effective || 'none'} → ${a.effective || 'none'}`
    case 'access.user_override_expired':
      return `Exception on ${b.feature} expired`
    default:
      return entry.reason || entry.action
  }
}
