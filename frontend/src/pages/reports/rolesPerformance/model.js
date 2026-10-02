// Roles Performance: the rules the page draws by, kept out of the components
// so they can be tested on their own. The numbers themselves come from the
// server (app/services/performance); nothing here computes a measure.

import { canCompare } from '../../../lib/roles'

export const TAB_LABELS = {
  month: 'Month',
  area: 'Area',
  performance: 'Performance',
  compare: 'Compare',
  map: 'Map',
}

const OWN_LABELS = { area: 'My area', performance: 'My performance' }

/** The tabs a role gets, in order. Admin gets none (the route refuses it). */
export function tabsFor(user) {
  if (canCompare(user)) return ['month', 'area', 'performance', 'compare', 'map']
  if (['RegionalManager', 'Coordinator', 'Contractor'].includes(user?.role?.name)) {
    return ['area', 'performance', 'map']
  }
  return []
}

export function tabLabel(user, tab) {
  return !canCompare(user) && OWN_LABELS[tab] ? OWN_LABELS[tab] : TAB_LABELS[tab]
}

/** Where /reports/kpi lands: PM and Viewer on Month, everyone else on My area. */
export function landingTab(user) {
  return tabsFor(user)[0] ?? null
}

export const ROLE_LABELS = {
  PM: 'PM',
  Viewer: 'General manager',
  RegionalManager: 'Regional manager',
  Coordinator: 'Coordinator',
  Contractor: 'Contractor',
}

// ----- Colours ----------------------------------------------------------
//
// Data colours, one per Month row, always shown beside their label. Green
// and red are reserved for good and bad change (the +/- chips).

export const ROW_COLOURS = {
  on_air: { ink: '#5F6B7E', soft: '#B8C1CF' },
  dt_done: { ink: '#2F5FD0', soft: '#9DB4EE' },
  ict_approved: { ink: '#8E2F74', soft: '#D29BC2' },
  cra_approved: { ink: '#17877B', soft: '#8ED3C9' },
  fully_approved: { ink: '#1D3F99', soft: '#9DB4EE' },
  full_config: { ink: '#1D7A4B', soft: '#93CDA9' },
  fell_back: { ink: '#5F6B7E', soft: '#B8C1CF' },
  problem_resolved: { ink: '#1D7A4B', soft: '#93CDA9' },
  problem_new: { ink: '#B42F2A', soft: '#E59D97' },
}

// ----- Numbers ----------------------------------------------------------

export function fmtCount(value) {
  return value == null ? '—' : Math.round(value).toLocaleString('en-US')
}

export function fmtPct(value) {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

/** A signed change. Zero reads "±0", so "no change" is never mistaken for a gain. */
export function fmtDelta(value, suffix = '') {
  if (value == null) return '—'
  if (value === 0) return `±0${suffix}`
  const shown = Number.isInteger(value) ? Math.abs(value).toLocaleString('en-US') : Math.abs(value).toFixed(1)
  return `${value > 0 ? '+' : '−'}${shown}${suffix}`
}

/** 'good' | 'bad' | 'flat' for a change; inverted where lower is better. */
export function deltaTone(delta, lowerIsBetter = false) {
  if (delta == null || delta === 0) return 'flat'
  const better = lowerIsBetter ? delta < 0 : delta > 0
  return better ? 'good' : 'bad'
}

export function fmtDays(value) {
  return value == null ? '—' : `${value.toFixed(1)} d`
}

// ----- The Month block row ----------------------------------------------

/**
 * The blocks one Month row draws. ceil(max(now, ref) / per) blocks:
 *
 *   done     filled, this month (the last one may be partial: `fill` < 1)
 *   beyond   filled and ringed: done this month, past last month's figure
 *   short    outlined and empty: last month got here, this month has not yet
 *
 * A row with nothing in either month draws no blocks.
 */
export function blocks(now, ref, per) {
  const current = Math.max(now ?? 0, 0)
  const previous = Math.max(ref ?? 0, 0)
  const count = Math.ceil(Math.max(current, previous) / per)
  const out = []
  for (let i = 0; i < count; i += 1) {
    const start = i * per
    const fill = Math.min(Math.max((current - start) / per, 0), 1)
    let kind
    if (fill > 0) kind = ref != null && start >= previous ? 'beyond' : 'done'
    else kind = 'short'
    out.push({ kind, fill })
  }
  return out
}

/** Share of the leader, for an owner's 4px bar (max 64px). */
export function barWidth(value, leader, max = 64) {
  if (!leader || !value || value < 0) return 0
  return Math.round((value / leader) * max)
}

// ----- Scope picker -----------------------------------------------------

export const SCOPE_GROUPS = [
  { lens: 'rm', label: 'Regional managers' },
  { lens: 'coordinator', label: 'Coordinators' },
  { lens: 'contractor', label: 'Contractors' },
  { lens: 'region', label: 'CRA regions' },
  { lens: 'province', label: 'Provinces' },
]

export const COUNTRY = { lens: 'country', key: 'Whole country', label: 'Whole country' }

/** "rm:Pirayesh" <-> { lens, key }: one value for a <select>. */
export function scopeValue(scope) {
  return scope?.lens === 'country' || !scope ? 'country' : `${scope.lens}:${scope.key}`
}

export function parseScopeValue(value) {
  if (!value || value === 'country') return { lens: 'country', key: null }
  const at = value.indexOf(':')
  return { lens: value.slice(0, at), key: value.slice(at + 1) }
}

/** Query params for a scope; the country is the server's default. */
export function scopeParams(scope) {
  if (!scope || scope.lens === 'country') return {}
  return { lens: scope.lens, key: scope.key }
}

/** "1405-07" from a { year, month } entry. */
export function monthKey(entry) {
  return `${entry.year}-${String(entry.month).padStart(2, '0')}`
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
