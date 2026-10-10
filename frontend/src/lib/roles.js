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

// The two roles that carry equal authority over the health check and drive
// test lifecycle: assign an initial health check, review its result, decide
// Ready or Problematic, route a problematic site, assign an official drive
// test, pick or change the drive test contractor, and approve a drive test.
//
// One helper because the interface previously spelled this out five times and
// spelled it differently each time -- HC Results offered an assign bar to
// ['Admin','PM'] while the server allowed PM alone, so an Admin was shown a
// control that answered 403 and a Coordinator was shown none at all.
//
// The server decides permissions; this only shapes what the UI offers, and it
// must agree with app/core/deps.py:require_review_authority.
export const REVIEW_AUTHORITY_ROLES = ['PM', 'Coordinator']

export function canReview(user) {
  return REVIEW_AUTHORITY_ROLES.includes(user?.role?.name)
}

// The monthly plan (PIP) screen. Contractors fill one in; PM decides them;
// Coordinator, Regional Manager and Viewer read the queue. Admin is absent on
// purpose -- setting a contractor's monthly target is an operational act, and
// Admin is a systems role (ARCHITECTURE.md, and api/monthly_plan.py, which
// gives the decision to PM alone).
//
// Must agree with app/api/monthly_plan.py: the queue's readers plus the
// contractor side. Backend-side Admin may read the queue; the interface does
// not offer it, because there is nothing on that screen Admin acts on.
export const MONTHLY_PLAN_ROLES = [
  'Contractor',
  'PM',
  'Coordinator',
  'RegionalManager',
  'Viewer',
]

// Who decides a plan. PM alone, as on the server.
export function canDecidePlans(user) {
  return user?.role?.name === 'PM'
}

// MTN's internal PIP. Every staff role the Monthly Plan page serves reads it
// today -- GET /pip/overview carries it to PM, Coordinator, RegionalManager
// and Viewer -- and no contractor does. Must agree with OVERVIEW_READERS in
// app/api/monthly_plan.py.
export const INTERNAL_PIP_ROLES = ['PM', 'Coordinator', 'RegionalManager', 'Viewer']

export function canSeeInternalPip(user) {
  return INTERNAL_PIP_ROLES.includes(user?.role?.name)
}

// The Acceptance Dashboard's monthly target. Same decider as the PIP —
// PM alone — and must agree with app/api/acceptance.py's own `require_pm`
// alias over PUT /acceptance/plan.
export function canSetAcceptancePlan(user) {
  return user?.role?.name === 'PM'
}

// Roles Performance (and Lifecycle Gaps). Five roles see it and Admin sees
// none of it -- the product owner's rule, and the same list
// app/services/kpi.py enforces. This only shapes what the interface offers;
// every KPI endpoint re-checks the role and re-derives the scope itself.
export const KPI_ROLES = ['PM', 'Viewer', 'RegionalManager', 'Coordinator', 'Contractor']

export function canSeeKpi(user) {
  return KPI_ROLES.includes(user?.role?.name)
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

// The Action Center (the ticket board). The four roles that act on queues get
// it; Regional Manager and Viewer do not -- they land on their dashboards --
// and neither does Admin. Must agree with board_role() in
// app/services/action_queues/context.py; the server answers 403 to the rest.
export const ACTION_CENTER_ROLES = ['PM', 'Coordinator', 'Contractor', ...CATEGORY_OWNER_ROLES]

export function hasActionCenter(roleName) {
  return ACTION_CENTER_ROLES.includes(roleName)
}

// UEP Home: the board's roles, and Regional Managers (Home's headline
// acceptance queues, inside their provinces). A Regional Manager still lands
// on Roles Performance and opens Home from the navigation. Must agree with
// home_role() in app/services/action_queues/context.py.
export const HOME_ROLES = [...ACTION_CENTER_ROLES, 'RegionalManager']

export function hasHome(roleName) {
  return HOME_ROLES.includes(roleName)
}

// Where "/" lands for each role. Everyone who works a queue lands on UEP Home
// (what is waiting, what is late, what to do next; the full board stays at
// /action-center); Regional Manager on Roles Performance (My area), Viewer on
// the Drive Test dashboard, Admin on the Admin Console. Home is served to
// HOME_ROLES -- GET /home/summary refuses the rest.
const HOME_BY_ROLE = {
  Admin: '/admin',
  RegionalManager: '/reports/kpi',
  Viewer: '/reports/drive-test',
}

export function homeFor(roleName) {
  return HOME_BY_ROLE[roleName] || (hasActionCenter(roleName) ? '/home' : '/reports/drive-test')
}
