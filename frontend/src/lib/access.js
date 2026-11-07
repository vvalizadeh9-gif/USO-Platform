/**
 * The central permission map: who may open which area of UEP.
 *
 * `accessMatrix.json` is the same file the backend reads
 * (backend/app/core/access_matrix.json; a backend test fails when the two
 * differ). The launcher, Home's Apps panel, the rails, the route guards and
 * the pages ask this module, never a role list of their own. The server
 * re-checks every area on every request; this only shapes what is offered.
 *
 * `offered` roles see an area in navigation; `direct` roles may still open it
 * by URL (Admin keeps the access it had) but are never offered it.
 */
import matrix from './accessMatrix.json'

/** @typedef {keyof typeof matrix.areas} AreaName */

export const AREA = Object.freeze({
  ROLES_PERFORMANCE: 'roles_performance',
  LIFECYCLE_GAPS: 'lifecycle_gaps',
  /** The "ICT vs CRA vs Mojri tracker" card on Lifecycle Gaps. */
  MOJRI_SECTION: 'mojri_section',
  /** Insights › Drive test dashboard and Acceptance dashboard. */
  INSIGHTS_DASHBOARDS: 'insights_dashboards',
  EXPLORER: 'explorer',
  EXPLORER_ALL_SITES: 'explorer_all_sites',
  /** Acceptance › Filing (My Work). */
  ACCEPTANCE_WORKSPACE: 'acceptance_workspace',
  MONTHLY_PLAN_QUEUE: 'monthly_plan_queue',
  INTERNAL_PIP: 'internal_pip',
})

function entry(area) {
  const found = matrix.areas[area]
  if (!found) throw new Error(`Unknown access area: ${area}`)
  return found
}

/** The roles navigation offers this area to. */
export function offeredRoles(area) {
  return [...entry(area).offered]
}

/** The roles that may open this area: offered, plus direct-only. */
export function allowedRoles(area) {
  const { offered, direct } = entry(area)
  return [...offered, ...direct]
}

/** Whether navigation offers `area` to this role. */
export function isOffered(roleName, area) {
  return entry(area).offered.includes(roleName)
}

/** Whether this role may open `area` (by link or by URL). */
export function canAccess(roleName, area) {
  return allowedRoles(area).includes(roleName)
}

/** 'region' | 'work' | 'standard': which Home variant this role lands on. */
export function landingFor(roleName) {
  return matrix.landings[roleName] || 'standard'
}
