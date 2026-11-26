import { FEATURE, can, isOffered, landingFor } from './access'

// Maps internal role names (as stored in the DB and used for authorization)
// to human-friendly display labels. Keeping this in one place means the UI
// can be relabelled without touching any permission logic.
const ROLE_LABELS = {
  Admin: 'Administrator',
  PM: 'Project Manager',
  Coordinator: 'Coordinator',
  RegionalManager: 'Regional Manager',
  Contractor: 'Contractor',
  Viewer: 'Viewer',
  // Health-check problem-category owners. Each owns one category and works
  // only its Fix Queue.
  CpgPower: 'CPG Power',
  CpgRolloutPM: 'CPG Rollout Project Manager (On-Site)',
  ManagedService: 'Managed Service (MS)',
  NwgPlanning: 'NWG Planning',
  HuaweiCleanup: 'Huawei Cleanup',
  // UEP-22: the CPG PSO acceptance basket (a team role, no HC category).
  CpgPso: 'CPG PSO',
}

// The roles that own a health-check problem category. Used for route
// guards and nav visibility; the backend decides permissions from
// Role.is_category_owner, so this list only shapes what the UI offers.
export const CATEGORY_OWNER_ROLES = [
  'CpgPower',
  'CpgRolloutPM',
  'ManagedService',
  'NwgPlanning',
  'HuaweiCleanup',
]

export function isCategoryOwner(roleName) {
  return CATEGORY_OWNER_ROLES.includes(roleName)
}

export function roleLabel(name) {
  return ROLE_LABELS[name] || name
}

// UEP-25: what a person may do comes from GET /me/access (lib/access.js),
// managed in Admin › Access. Each helper below names the feature it reads, so
// a tick in Admin changes the interface without a deploy. The server checks
// the same feature on every request; this only shapes what is offered.

// Assign, review and confirm health checks; route a problematic site; assign
// and approve drive tests. PM and Coordinator on day one.
export function canReview(user) {
  return can(user, FEATURE.HC_WORK, 'edit')
}

// Who files ICT and CRA letters (acceptance outcome filing).
export function canFileAcceptance(user) {
  return can(user, FEATURE.ACCEPTANCE_FILING, 'edit')
}

// The monthly plan screen: the contractor's own form, or the month's queue
// (offered in menus; Admin keeps URL-only access to the queue's API and is
// not offered the page).
export function canOpenMonthlyPlan(user) {
  return can(user, FEATURE.CONTRACTOR_PLAN, 'edit') || isOffered(user, FEATURE.MONTHLY_PLAN_QUEUE)
}

// Who decides a plan.
export function canDecidePlans(user) {
  return can(user, FEATURE.PLAN_APPROVALS, 'edit')
}

// MTN's internal PIP and plan history.
export function canSeeInternalPip(user) {
  return can(user, FEATURE.INTERNAL_PIP)
}

// The Acceptance Dashboard's monthly target.
export function canSetAcceptancePlan(user) {
  return can(user, FEATURE.ACCEPTANCE_TARGET, 'edit')
}

// Roles Performance.
export function canSeeKpi(user) {
  return can(user, FEATURE.ROLES_PERFORMANCE)
}

// The Mojri card on Lifecycle Gaps ("ICT vs CRA vs Mojri tracker"). For
// everyone else the server sends no Mojri figures at all.
export function canSeeMojri(user) {
  return can(user, FEATURE.MOJRI_SECTION)
}

// PM and Viewer may choose any scope and see owners ranked side by side.
// Everyone else is confined to their own. Must agree with kpi.may_compare.
export function canCompare(user) {
  return ['PM', 'Viewer'].includes(user?.role?.name)
}

// Viewer is a read-only PM: the same numbers, no action of any kind. Hiding a
// button is not the access rule -- every write route refuses Viewer -- it is
// the interface not offering what would only answer 403.
export function isReadOnlyKpi(user) {
  return user?.role?.name === 'Viewer'
}

// The roles that own pending work (queues). Regional Manager, Viewer and
// Admin own none. Must agree with board_role() in
// app/services/action_queues/context.py.
export const WORK_ROLES = ['PM', 'Coordinator', 'Contractor', ...CATEGORY_OWNER_ROLES, 'CpgPso']

export function hasWorkQueues(roleName) {
  return WORK_ROLES.includes(roleName)
}

// UEP Home: the work roles, and Regional Managers, who land on its region
// variant (pages/home/RegionHome.jsx). Which variant a role sees is the
// central permission map's `landings`; see landingFor in lib/access.js.
export const HOME_ROLES = [...WORK_ROLES, 'RegionalManager']

export function hasHome(roleName) {
  return HOME_ROLES.includes(roleName)
}

// Where "/" lands for each role -- every sign-in arrives here. Everyone who
// works a queue, and Regional Managers, land on UEP Home (each on their own
// variant); Viewer on Roles Performance (decided October 2026), Admin on the
// Admin Console.
const HOME_BY_ROLE = {
  Admin: '/admin',
  Viewer: '/reports/kpi',
}

// UEP-25: a role whose landing is an app route (a new role made in Admin ›
// Access, say "CPO" landing on /explorer) starts there. Pass the user; a bare
// role name still works for the built-in roles.
export function homeFor(subject) {
  const roleName = typeof subject === 'string' ? subject : subject?.role?.name
  const landing = typeof subject === 'string' ? null : landingFor(subject)
  if (landing && landing.startsWith('/')) return landing
  if (HOME_BY_ROLE[roleName]) return HOME_BY_ROLE[roleName]
  if (hasHome(roleName)) return '/home'
  if (!can(subject, FEATURE.INSIGHTS_DASHBOARDS) && can(subject, FEATURE.EXPLORER)) return '/explorer'
  return '/reports/drive-test'
}
