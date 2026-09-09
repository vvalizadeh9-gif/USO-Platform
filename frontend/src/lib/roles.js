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
