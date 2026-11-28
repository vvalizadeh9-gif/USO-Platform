/**
 * Who may use which feature of UEP (UEP-25).
 *
 * Access is managed in Admin › Access and read from GET /me/access, which
 * AuthContext loads on page load and every 5 minutes and attaches to the
 * signed-in user as `user.access`:
 *
 *   { features: { explorer: 'view', hc_work: 'edit', … },
 *     hidden_in_menus: ['insights_dashboards', …],
 *     exceptions: [...], landing: 'standard', role: 'PM', data_scope_type: 'all' }
 *
 * The launcher, Home's Apps panel, the rails, the route guards and the pages
 * ask this module, never a role list of their own. The server re-checks every
 * feature on every request; this only shapes what is offered.
 *
 * A feature in `hidden_in_menus` may be opened by URL but is not offered in
 * navigation (the old "direct" entries: Admin keeps the API access it had).
 *
 * accessMatrix.json is no longer read here: it is the day-one seed, used by
 * tests only.
 */

export const FEATURE = Object.freeze({
  ROLES_PERFORMANCE: 'roles_performance',
  LIFECYCLE_GAPS: 'lifecycle_gaps',
  /** The "ICT vs CRA vs Mojri tracker" card on Lifecycle Gaps. */
  MOJRI_SECTION: 'mojri_section',
  /** Insights › Drive test dashboard and Acceptance dashboard. */
  INSIGHTS_DASHBOARDS: 'insights_dashboards',
  EXPLORER: 'explorer',
  EXPLORER_ALL_SITES: 'explorer_all_sites',
  ACCEPTANCE_WORKSPACE: 'acceptance_workspace',
  /** Acceptance › Filing (UEP-22): the cases inbox, team roles included. */
  ACCEPTANCE_CASES: 'acceptance_cases',
  ACCEPTANCE_BASKETS: 'acceptance_baskets',
  MONTHLY_PLAN_QUEUE: 'monthly_plan_queue',
  INTERNAL_PIP: 'internal_pip',
  /** Acceptance › Submissions (UEP-21); acting is PM and the owner only. */
  SUBMISSIONS: 'submissions',
  HC_WORK: 'hc_work',
  DT_ASSIGNMENT: 'dt_assignment',
  DT_REVIEW: 'dt_review',
  DT_EVIDENCE: 'dt_evidence',
  FIELD_RESULTS: 'field_results',
  CONTRACTOR_WORK: 'contractor_work',
  FIX_QUEUE: 'fix_queue',
  REASSIGN_WORK: 'reassign_work',
  ACCEPTANCE_FILING: 'acceptance_filing',
  ACCEPTANCE_APPROVE: 'acceptance_approve',
  VALIDATION: 'validation',
  SCAN_UPLOAD: 'scan_upload',
  CONTRACTOR_PLAN: 'contractor_plan',
  PLAN_APPROVALS: 'plan_approvals',
  ACCEPTANCE_TARGET: 'acceptance_target',
  KPI_MAPPING: 'kpi_mapping',
  EXPORTS: 'exports',
  USERS: 'users',
  ACCESS: 'access',
  PROVINCE_ASSIGNMENTS: 'province_assignments',
  SLA_POLICIES: 'sla_policies',
  /** Admin › Sign-in page (UEP-26). */
  SIGNIN_SETTINGS: 'signin_settings',
  PROBLEM_CATEGORIES: 'problem_categories',
  PROVINCES: 'provinces',
  ACTION_SLA: 'action_sla',
  CPM_IMPORT: 'cpm_import',
  CPM_CHANGE_REQUESTS: 'cpm_change_requests',
  /** Admin › Data import (UEP-29). */
  DATA_IMPORT: 'data_import',
  MOJRI_UPLOAD: 'mojri_upload',
  ADMIN_OVERVIEW: 'admin_overview',
  SYSTEM_HEALTH: 'system_health',
  AUDIT_LOG: 'audit_log',
})

/** The pre-UEP-25 name, kept so area checks read as they did. */
export const AREA = FEATURE

const RANK = { none: 0, view: 1, edit: 2 }

/** The access object, from a user (`user.access`) or an access object itself. */
export function accessOf(subject) {
  if (!subject) return null
  if (subject.features) return subject
  return subject.access || null
}

/** 'none' | 'view' | 'edit'. */
export function levelOf(subject, feature) {
  return accessOf(subject)?.features?.[feature] || 'none'
}

/** Whether the user holds at least `level` on `feature` (by link or by URL). */
export function can(subject, feature, level = 'view') {
  return RANK[levelOf(subject, feature)] >= RANK[level]
}

/** Whether navigation offers `feature`: allowed, and not hidden in menus. */
export function isOffered(subject, feature, level = 'view') {
  if (!can(subject, feature, level)) return false
  return !(accessOf(subject)?.hidden_in_menus || []).includes(feature)
}

/** Whether the user may open `area` (the pre-UEP-25 name for `can`). */
export function canAccess(subject, area) {
  return can(subject, area)
}

/** 'standard' | 'region' | 'work' | an app route such as '/explorer'. */
export function landingFor(subject) {
  return accessOf(subject)?.landing || 'standard'
}

/** Whether an access object came with a personal exception on `feature`. */
export function isException(subject, feature) {
  return (accessOf(subject)?.exceptions || []).includes(feature)
}

/**
 * A navigation requirement, as written in the app registry and route guards:
 * `'explorer'`, `['hc_work', 'edit']`, `{ any: [...] }`, or a function of the user.
 * `offered` asks for the menu answer (hidden features left out).
 */
export function meets(user, need, { offered = false } = {}) {
  if (!need) return true
  if (typeof need === 'function') return Boolean(need(user))
  if (typeof need === 'string') return offered ? isOffered(user, need) : can(user, need)
  if (Array.isArray(need)) {
    const [feature, level = 'view'] = need
    return offered ? isOffered(user, feature, level) : can(user, feature, level)
  }
  if (need.any) return need.any.some((n) => meets(user, n, { offered }))
  if (need.all) return need.all.every((n) => meets(user, n, { offered }))
  return false
}
