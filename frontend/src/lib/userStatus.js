// The three states an account can be in, mirrored from the backend's
// app/core/user_status.py.
//
// Duplicated deliberately, and kept small. The interface needs the list to
// build a dropdown before it has asked the server anything, and the server
// validates every value it is sent — so a mismatch here is a form option that
// comes back as a 422, not a state the platform can be put into.

export const ACTIVE = 'Active'
export const INACTIVE = 'Inactive'
export const SUSPENDED = 'Suspended'

export const USER_STATUSES = [ACTIVE, INACTIVE, SUSPENDED]

// What each state means, in the words an administrator choosing between them
// needs. Shown beside the option rather than buried in documentation, because
// the difference between Inactive and Suspended is the entire reason there are
// three states and not two.
export const STATUS_HELP = {
  [ACTIVE]: 'Can sign in and work normally.',
  [INACTIVE]: 'No longer uses the platform — they left, or changed role.',
  [SUSPENDED]: 'Access withdrawn deliberately, and usually temporarily.',
}

// Amber rather than red for Suspended: it is meant to be reversed, and red is
// what the table already uses for the states that are not.
const STATUS_PILL = {
  [ACTIVE]: 'pill-green',
  [INACTIVE]: 'pill-dim',
  [SUSPENDED]: 'pill-amber',
}

export function statusPillClass(status) {
  return STATUS_PILL[status] || 'pill-dim'
}

export function canSignIn(status) {
  return status === ACTIVE
}

// The verb for the button that moves an account *to* this status, which is not
// always the status's own name — "Deactivate" reads as an action where
// "Inactive" reads as a label.
export const STATUS_VERB = {
  [ACTIVE]: 'Reactivate',
  [INACTIVE]: 'Deactivate',
  [SUSPENDED]: 'Suspend',
}
