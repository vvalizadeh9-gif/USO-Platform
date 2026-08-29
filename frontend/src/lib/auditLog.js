// Turning an audit row into a sentence an administrator can read.
//
// This used to *infer* what had happened from the shape of `new_value` and the
// wording of a free-text `reason`, in a switch with one branch per entity type.
// That was the only place the verb existed, so nothing could be filtered or
// counted by it, and any event nobody had written a branch for came out
// described wrongly — confidently, and in a table that looks authoritative.
//
// The backend now records an `action` from a closed vocabulary (see
// app/core/audit_actions.py). This file's job is only to phrase it. The
// important consequence is the fallback: an action this file has never seen
// still renders as a readable sentence naming the actor and the record, so the
// backend can add one without the audit screen going quiet about it.

const ENTITY_LABELS = {
  User: 'user',
  PasswordResetRequest: 'a password reset request',
  CpmChangeRequest: 'a CPM change request',
  CpmDataWipe: 'all CPM data',
  CpmImportBatch: 'a CPM import',
  WorkItem: 'work item',
  WorkItemBulk: 'a bulk assignment',
  HcAssignment: 'health check assignment',
  HcTask: 'health check task',
  HcRemediation: 'a health check fix',
  DriveTest: 'a drive test',
  Acceptance: 'an acceptance record',
  AcceptanceSubmission: 'an acceptance submission',
}

// How each action reads in a sentence, after the actor's name. Present tense,
// past form: "Maryam suspended user #7".
const ACTION_PHRASES = {
  LOGIN_SUCCESS: 'signed in',
  LOGIN_FAILED: 'failed to sign in',
  LOGOUT: 'signed out',
  PASSWORD_CHANGED: 'changed their password',
  PASSWORD_RESET: 'reset the password for',
  PASSWORD_RESET_REQUESTED: 'requested a password reset',

  USER_CREATED: 'created',
  USER_UPDATED: 'updated',
  USER_ACTIVATED: 'activated',
  USER_DEACTIVATED: 'deactivated',
  USER_SUSPENDED: 'suspended',
  USER_REACTIVATED: 'reactivated',
  USER_ROLE_CHANGED: 'changed the role of',
  USER_ACCESS_CHANGED: 'changed the access of',

  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  IMPORTED: 'imported',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RETURNED: 'returned',
  ASSIGNED: 'assigned',
  REVIEWED: 'reviewed',
  DATA_WIPED: 'erased',
}

// Short labels for the filter dropdown, where a phrase like "failed to sign in"
// reads oddly as an option.
export const ACTION_LABELS = {
  LOGIN_SUCCESS: 'Sign-in',
  LOGIN_FAILED: 'Failed sign-in',
  LOGOUT: 'Sign-out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET: 'Password reset',
  PASSWORD_RESET_REQUESTED: 'Reset requested',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_ACTIVATED: 'User activated',
  USER_DEACTIVATED: 'User deactivated',
  USER_SUSPENDED: 'User suspended',
  USER_REACTIVATED: 'User reactivated',
  USER_ROLE_CHANGED: 'Role changed',
  USER_ACCESS_CHANGED: 'Access changed',
  CREATED: 'Created',
  UPDATED: 'Updated',
  DELETED: 'Deleted',
  IMPORTED: 'Imported',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  ASSIGNED: 'Assigned',
  REVIEWED: 'Reviewed',
  DATA_WIPED: 'Data erased',
}

// The authentication events, grouped so the audit screen can offer "everything
// that happened at the front door" as one choice.
export const AUTH_ACTIONS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT',
  'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PASSWORD_RESET_REQUESTED',
]

export const ACCOUNT_ACTIONS = [
  'USER_CREATED', 'USER_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED',
  'USER_SUSPENDED', 'USER_REACTIVATED', 'USER_ROLE_CHANGED',
  'USER_ACCESS_CHANGED',
]

export const PORTAL_ACTIONS = [
  'CREATED', 'UPDATED', 'DELETED', 'IMPORTED', 'SUBMITTED',
  'APPROVED', 'REJECTED', 'RETURNED', 'ASSIGNED', 'REVIEWED', 'DATA_WIPED',
]

// An action the backend has added and this file has not: MY_NEW_ACTION becomes
// "My new action" rather than a blank cell.
function humanise(action) {
  if (!action) return ''
  const words = String(action).toLowerCase().split('_').filter(Boolean).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || humanise(action)
}

function entityLabel(entityType) {
  return ENTITY_LABELS[entityType] || entityType
}

// The extra clause that makes a row worth reading — what was assigned, what
// decision was recorded, how much was erased. Everything else is in the
// expandable before/after panel; this is only what belongs on one line.
function detail(entry) {
  const nv = entry.new_value || {}

  switch (entry.entity_type) {
    case 'CpmDataWipe': {
      const total = Object.values(nv).reduce((sum, v) => sum + (Number(v) || 0), 0)
      return `${total} records removed`
    }
    case 'CpmImportBatch':
      return [nv.filename, nv.rows != null ? `${nv.rows} rows` : null]
        .filter(Boolean).join(', ')
    case 'WorkItemBulk':
      return nv.count != null ? `${nv.count} work items` : ''
    case 'Acceptance':
      return `ICT: ${nv.ict || '—'}, CRA: ${nv.cra || '—'}`
    case 'HcTask':
      return nv.overall_result || nv.problem_category || ''
    case 'User':
      return nv.username || ''
    default:
      return nv.status || nv.review_status || nv.decision || ''
  }
}

export function describeAuditEntry(entry) {
  if (!entry) return ''
  const actor = entry.user_full_name || 'System'
  const phrase = ACTION_PHRASES[entry.action] || humanise(entry.action).toLowerCase()
  const idPart = entry.entity_id != null ? ` #${entry.entity_id}` : ''

  // The authentication events are about the actor themselves, so naming the
  // "user #7" they acted on would be saying the same person twice.
  if (AUTH_ACTIONS.includes(entry.action)) {
    const who = entry.user_full_name
      || (entry.new_value || {}).username
      || 'Someone'
    const why = entry.result === 'Failure' && entry.reason ? ` (${entry.reason})` : ''
    if (entry.action === 'PASSWORD_RESET') {
      return `${actor} reset the password for "${(entry.new_value || {}).username || 'a user'}"`
    }
    return `${who} ${phrase}${why}`
  }

  const label = entityLabel(entry.entity_type)
  const extra = detail(entry)
  const suffix = extra ? ` (${extra})` : ''
  return `${actor} ${phrase} ${label}${idPart}${suffix}`
}

export const AUDIT_MODULES = ['Auth', 'Admin', 'CPM', 'Assignment', 'HealthCheck', 'DriveTest', 'Acceptance']

export const AUDIT_ENTITY_TYPES = [
  'User', 'PasswordResetRequest', 'CpmChangeRequest', 'CpmDataWipe',
  'CpmImportBatch', 'WorkItem', 'WorkItemBulk', 'HcAssignment', 'HcTask',
  'HcRemediation', 'DriveTest', 'Acceptance', 'AcceptanceSubmission',
]

export const AUDIT_RESULTS = ['Success', 'Failure']

export function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
