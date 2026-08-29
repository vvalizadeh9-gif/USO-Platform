// Turning an audit row into a sentence.
//
// This is the readable face of the accountability trail — the thing an admin
// actually looks at when asking who changed what. It is worth testing for a
// reason that is not obvious: it renders values that came from *elsewhere*
// (actions and reasons written by the backend), so the failure mode is not a
// crash, it is a row that quietly says nothing useful about a real event.
// "System updated undefined" is worse than no audit log, because it looks like
// an answer.
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUTH_ACTIONS,
  PORTAL_ACTIONS,
  actionLabel,
  actorLabel,
  describeAuditEntry,
  formatDateTime,
} from './auditLog'

const base = {
  user_full_name: 'Maryam',
  entity_id: 7,
  new_value: {},
  action: 'UPDATED',
  result: 'Success',
}

const EVERY_ACTION = [...AUTH_ACTIONS, ...ACCOUNT_ACTIONS, ...PORTAL_ACTIONS]

describe('describeAuditEntry', () => {
  it('names the person who did it', () => {
    expect(describeAuditEntry({ ...base, entity_type: 'WorkItem' })).toMatch(/^Maryam /)
  })

  it('says System when the actor is gone', () => {
    // user_id is nullable, and a row written by a background task has none.
    expect(
      describeAuditEntry({ ...base, user_full_name: null, entity_type: 'WorkItem' }),
    ).toMatch(/^System /)
  })

  it('describes every action the filter offers, without leaking a placeholder', () => {
    // The Audit Log tab lets an admin filter by each of these. Every one has
    // to produce a sentence, or filtering to it shows a list of nonsense.
    for (const action of EVERY_ACTION) {
      for (const entityType of AUDIT_ENTITY_TYPES) {
        const text = describeAuditEntry({ ...base, action, entity_type: entityType })
        expect(text, `${action} / ${entityType}`).toBeTruthy()
        expect(text, `${action} / ${entityType}`).not.toMatch(/undefined|null|\[object/)
      }
    }
  })

  it('gives every action a filter label', () => {
    for (const action of EVERY_ACTION) {
      expect(actionLabel(action), action).toBeTruthy()
      expect(actionLabel(action), action).not.toMatch(/_/)
    }
  })

  // -------------------------------------------------------------------------
  // Authentication events, which are about the actor rather than a record
  // -------------------------------------------------------------------------
  it('reads a sign-in as being about the person who signed in', () => {
    expect(
      describeAuditEntry({ ...base, action: 'LOGIN_SUCCESS', entity_type: 'User' }),
    ).toBe('Maryam signed in')
  })

  it('says why a sign-in failed', () => {
    expect(
      describeAuditEntry({
        ...base,
        action: 'LOGIN_FAILED',
        entity_type: 'User',
        result: 'Failure',
        reason: 'Incorrect password',
      }),
    ).toBe('Maryam failed to sign in (Incorrect password)')
  })

  it('names the attempted username when the account does not exist', () => {
    // The row has no user to resolve, so the only thing identifying the
    // attempt is what was typed — and an audit screen showing "Someone failed
    // to sign in" for every one of them is showing nothing.
    expect(
      describeAuditEntry({
        ...base,
        action: 'LOGIN_FAILED',
        entity_type: 'User',
        user_full_name: null,
        result: 'Failure',
        new_value: { username: 'ghost' },
        reason: 'No account with that username',
      }),
    ).toBe('ghost failed to sign in (No account with that username)')
  })

  it('names the identifier typed into the reset form when it matched nobody', () => {
    // Same gap as the failed sign-in above: the row has no user to resolve, so
    // without the identifier the log reads "Someone requested a password
    // reset" for every one of them — and a run of those is precisely what an
    // administrator needs to be able to tell apart.
    expect(
      describeAuditEntry({
        ...base,
        action: 'PASSWORD_RESET_REQUESTED',
        entity_type: 'User',
        user_full_name: null,
        result: 'Failure',
        new_value: { identifier: 'admin.backup' },
        reason: 'Password reset requested from the sign-in page',
      }),
    ).toBe('admin.backup requested a password reset')
  })

  it('does not repeat a reason that only restates the action', () => {
    // The parenthetical earns its place on a refused sign-in, where the reason
    // says why. On a reset request it restates the verb.
    const text = describeAuditEntry({
      ...base,
      action: 'PASSWORD_RESET_REQUESTED',
      entity_type: 'User',
      reason: 'Password reset requested from the sign-in page',
    })
    expect(text).toBe('Maryam requested a password reset')
  })

  it('distinguishes an admin reset from someone changing their own password', () => {
    const own = describeAuditEntry({
      ...base, action: 'PASSWORD_CHANGED', entity_type: 'User',
    })
    const reset = describeAuditEntry({
      ...base, action: 'PASSWORD_RESET', entity_type: 'User',
      new_value: { username: 'ali' },
    })

    expect(own).toBe('Maryam changed their password')
    expect(reset).toBe('Maryam reset the password for "ali"')
  })

  // -------------------------------------------------------------------------
  // Account events
  // -------------------------------------------------------------------------
  it('reads a user creation off the recorded username', () => {
    expect(
      describeAuditEntry({
        ...base, action: 'USER_CREATED', entity_type: 'User',
        new_value: { username: 'ali' },
      }),
    ).toBe('Maryam created user #7 (ali)')
  })

  it('uses the action, not the reason, to say what happened to an account', () => {
    // The verb used to be inferred from the wording of `reason`, so an entry
    // whose reason was phrased differently was described wrongly. It now comes
    // from the action, and the status is not repeated after it — "suspended
    // user #7 (Suspended)" says the same thing twice.
    const suspended = describeAuditEntry({
      ...base, action: 'USER_SUSPENDED', entity_type: 'User',
      new_value: { status: 'Suspended' },
      reason: 'phrased however the backend felt like',
    })
    expect(suspended).toBe('Maryam suspended user #7')
  })

  it('separates deactivation, suspension and reactivation', () => {
    const say = (action) =>
      describeAuditEntry({ ...base, action, entity_type: 'User', new_value: {} })

    expect(say('USER_DEACTIVATED')).toContain('deactivated')
    expect(say('USER_SUSPENDED')).toContain('suspended')
    expect(say('USER_REACTIVATED')).toContain('reactivated')
  })

  // -------------------------------------------------------------------------
  // Portal activity
  // -------------------------------------------------------------------------
  it('totals a data wipe rather than listing every table', () => {
    const text = describeAuditEntry({
      ...base,
      action: 'DATA_WIPED',
      entity_type: 'CpmDataWipe',
      entity_id: null,
      new_value: { sites: 10, work_items: 20, villages: 5 },
    })
    expect(text).toContain('35 records removed')
  })

  it('distinguishes the things that happen to a work item', () => {
    const wi = (action, new_value) =>
      describeAuditEntry({ ...base, action, entity_type: 'WorkItem', new_value })

    expect(wi('SUBMITTED', { status: 'Problematic' })).toContain('submitted')
    expect(wi('ASSIGNED', { contractor_id: 3 })).toContain('assigned')
    expect(wi('RETURNED', {})).toContain('returned')
  })

  it('renders an em dash rather than undefined for a missing value', () => {
    expect(
      describeAuditEntry({ ...base, entity_type: 'Acceptance', new_value: {} }),
    ).toBe('Maryam updated an acceptance record #7 (ICT: —, CRA: —)')
  })

  it('falls back to something readable for an action it has never seen', () => {
    // The backend can add an action without the frontend knowing. It must
    // still produce a sentence naming the actor and the record.
    const text = describeAuditEntry({
      ...base, action: 'SOME_FUTURE_ACTION', entity_type: 'SomeFutureThing',
    })
    expect(text).toBe('Maryam some future action SomeFutureThing #7')
  })

  it('omits the id when there is not one', () => {
    expect(
      describeAuditEntry({ ...base, entity_type: 'WorkItem', entity_id: null }),
    ).not.toContain('#')
  })

  it('does not throw on a row with nothing in it', () => {
    expect(describeAuditEntry(null)).toBe('')
    expect(describeAuditEntry({})).toBeTruthy()
  })
})

describe('formatDateTime', () => {
  it('formats a timestamp', () => {
    expect(formatDateTime('2026-08-28T13:45:00Z')).toMatch(/2026/)
  })

  it('returns the input rather than throwing on something unparseable', () => {
    // Better a raw string in one cell than a blank Audit Log tab.
    expect(formatDateTime('not a date')).toBeTruthy()
  })
})

describe('actorLabel', () => {
  it('names the person when the row resolves to one', () => {
    expect(actorLabel(base)).toBe('Maryam')
  })

  it('says System for a row a background task wrote', () => {
    expect(actorLabel({ ...base, user_full_name: null })).toBe('System')
  })

  it('shows what was typed for an attempt against a name nobody has', () => {
    // "System failed to sign in" is worse than no name at all: it reads as the
    // platform doing something, when what happened is a person trying a
    // username. It is also identical for every such row, which hides the one
    // pattern worth seeing — somebody working through a list.
    expect(
      actorLabel({ ...base, user_full_name: null, new_value: { username: 'j.unknown' } }),
    ).toBe('j.unknown')
    expect(
      actorLabel({ ...base, user_full_name: null, new_value: { identifier: 'admin.backup' } }),
    ).toBe('admin.backup')
  })

  it('does not throw on an empty row', () => {
    expect(actorLabel(null)).toBe('System')
    expect(actorLabel({})).toBe('System')
  })
})
