// Roles Performance: the rules the page draws by, kept out of the components
// so they can be tested on their own. The numbers themselves come from the
// server (app/services/performance); nothing here computes a measure.

import { canCompare } from '../../../lib/roles'
import { toPersianDigits } from '../../../lib/persianDigits'
import { shamsiMonthName } from '../../../lib/shamsi'
import { formatNumber } from '../../../lib/numbers'

export const TAB_LABELS = { month: 'Month', area: 'Area', map: 'Map' }

const OWN_LABELS = { area: 'My area' }

/** The tabs a role gets, in order. Admin gets none (the route refuses it). */
export function tabsFor(user) {
  if (canCompare(user)) return ['month', 'area', 'map']
  if (['RegionalManager', 'Coordinator', 'Contractor'].includes(user?.role?.name)) {
    return ['area', 'map']
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

/** The query a tab link carries: Area keeps the chosen scope, nothing else does. */
export function tabSearch(tab, search) {
  if (tab !== 'area') return ''
  const params = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const name of ['lens', 'key']) if (params.get(name)) kept.set(name, params.get(name))
  const text = kept.toString()
  return text ? `?${text}` : ''
}

export const ROLE_LABELS = {
  PM: 'PM',
  Viewer: 'General manager',
  RegionalManager: 'Regional manager',
  Coordinator: 'Coordinator',
  Contractor: 'Contractor',
}

// ----- Numbers ----------------------------------------------------------

export function fmtCount(value) {
  return value == null ? '—' : formatNumber(Math.round(value))
}

/** A rate as a whole percent: "51%". */
export function fmtRate(value) {
  return value == null ? '—' : `${Math.round(value)}%`
}

/** A share of a total, as a whole percent. */
export function sharePct(count, total) {
  return total ? Math.round((100 * count) / total) : 0
}

/** Persian digits for a number shown in Persian text ("day ۲۱ of ۳۰"). */
export function fa(value) {
  return toPersianDigits(String(value))
}

export function monthLabel(year, month) {
  return `${shamsiMonthName(month)} ${fa(year)}`
}

// ----- Month ------------------------------------------------------------

/** One headline measure per group: bold, larger figure. */
export const HEADLINE_MEASURES = new Set(['on_air', 'fully_approved', 'full_config', 'problem_resolved'])

export const MONTH_DEFAULT_MEASURE = 'fully_approved'

/** A Carbon icon per Month section. */
export const SECTION_ICONS = {
  delivery: 'flag',
  acceptance: 'checkmark--outline',
  full_config: 'settings--adjust',
  problematic: 'warning--alt',
}

/** Who a Month row belongs to, left to right. */
export const OWNER_COLUMNS = [
  { key: 'contractor', label: 'Contractors', noun: 'contractor' },
  { key: 'rm', label: 'Regional managers', noun: 'regional manager' },
  { key: 'coordinator', label: 'Coordinators', noun: 'coordinator' },
]

export const UNATTRIBUTED = 'Unattributed'

/**
 * One owner column: who is listed, who had none, and how the strip is drawn.
 *
 * `listed` holds everyone with something (named owners high to low, then
 * Unattributed); each carries `rank` -- 1 (leader), 2, 'rest' or 'none'
 * (Unattributed) -- which picks its colour. Only the top two named owners
 * carry colour; colour marks the exception, not every owner.
 */
export function ownerColumn(entries, total) {
  const named = entries.filter((e) => e.name !== UNATTRIBUTED)
  const some = named.filter((e) => e.now > 0)
  const none = named.filter((e) => !e.now)
  const unattributed = entries.find((e) => e.name === UNATTRIBUTED && e.now > 0)
  const listed = some.map((e, i) => ({
    name: e.name,
    count: e.now,
    share: sharePct(e.now, total),
    rank: i < 2 ? i + 1 : 'rest',
  }))
  if (unattributed) {
    listed.push({
      name: UNATTRIBUTED,
      count: unattributed.now,
      share: sharePct(unattributed.now, total),
      rank: 'none',
    })
  }
  const topTwo = some.slice(0, 2).reduce((sum, e) => sum + e.now, 0)
  return { listed, none: none.map((e) => e.name), topTwo: sharePct(topTwo, total) }
}

// ----- Month picker -----------------------------------------------------

const index = ({ year, month }) => year * 12 + month - 1

export function isFutureMonth(period, current) {
  return index(period) > index(current)
}

export function sameMonth(a, b) {
  return Boolean(a && b) && a.year === b.year && a.month === b.month
}

export function monthParam({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** "1405-07" -> { year, month }, or null. */
export function parseMonthParam(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(value || '')
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null
}

// ----- Area -------------------------------------------------------------

/** The pipeline, in order. On air, DT done and Fully approved are % of
 * villages; ICT and CRA are % of DT-done villages (the server divides). */
export const AREA_MEASURES = [
  { key: 'onair', label: 'On air', icon: 'flag' },
  { key: 'dt', label: 'DT done', icon: 'flag' },
  { key: 'full', label: 'Fully approved', icon: 'checkmark--outline' },
  { key: 'ict', label: 'ICT approved', icon: 'checkmark--outline' },
  { key: 'cra', label: 'CRA approved', icon: 'checkmark--outline' },
]

export const AREA_DEFAULT_MEASURE = 'full'

export const BREAKDOWNS = {
  province: { label: 'Provinces', one: 'province', many: 'provinces' },
  region: { label: 'CRA regions', one: 'CRA region', many: 'CRA regions' },
  contractor: { label: 'Contractors', one: 'contractor', many: 'contractors' },
  coordinator: { label: 'Coordinators', one: 'coordinator', many: 'coordinators' },
  rm: { label: 'Regional managers', one: 'regional manager', many: 'regional managers' },
}

/** The gap to national in whole points; null when either side is missing. */
export function gapPoints(rate, national) {
  if (rate == null || national == null) return null
  return Math.round(rate - national)
}

/** "−11 pts" / "+4 pts" / "±0", and its tone: worse is red, better is accent. */
export function fmtGap(points) {
  if (points == null) return { text: '—', tone: 'flat' }
  if (points === 0) return { text: '±0', tone: 'flat' }
  return {
    text: `${points > 0 ? '+' : '−'}${Math.abs(points)} pts`,
    tone: points > 0 ? 'better' : 'worse',
  }
}

/**
 * The ranking for one measure: compared rows by gap to national, furthest
 * behind first (ties by name), then the rows with too few DT-done villages
 * to compare. `behind` counts the compared rows below national.
 */
export function rankRows(rows, measure, national) {
  const byName = (a, b) => a.name.localeCompare(b.name)
  const compared = rows
    .filter((r) => !r.low_sample)
    .map((r) => {
      const rate = r.measures[measure].rate
      return { ...r, rate, gap: gapPoints(rate, national) }
    })
    .sort((a, b) => (a.rate ?? 0) - national - ((b.rate ?? 0) - national) || byName(a, b))
  const low = rows.filter((r) => r.low_sample).sort(byName)
  return {
    compared,
    low,
    behind: compared.filter((r) => r.gap != null && r.gap < 0).length,
  }
}

/** "Qazvin 40%, national 51%, 11 points behind". */
export function rankLabel(name, rate, national) {
  const points = gapPoints(rate, national)
  let gap = 'level with national'
  if (points > 0) gap = `${points} points ahead`
  if (points < 0) gap = `${-points} points behind`
  return `${name} ${fmtRate(rate)}, national ${fmtRate(national)}, ${gap}`
}

export function gapsLink(breakdown, row) {
  if (!row.gaps_key) return '/reports/gaps'
  return `/reports/gaps?${new URLSearchParams({ lens: breakdown, key: row.gaps_key })}`
}

// ----- Scope picker -----------------------------------------------------

export const SCOPE_GROUPS = [
  { lens: 'rm', label: 'Regional managers', one: 'Regional manager' },
  { lens: 'coordinator', label: 'Coordinators', one: 'Coordinator' },
  { lens: 'contractor', label: 'Contractors', one: 'Contractor' },
  { lens: 'region', label: 'CRA regions', one: 'CRA region' },
  { lens: 'province', label: 'Provinces', one: 'Province' },
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

export function prefersReducedMotion() {
  if (typeof document !== 'undefined' && document.documentElement.dataset.uepMotion === 'reduce') {
    return true
  }
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
