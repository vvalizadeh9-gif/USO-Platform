// Turning an audit row into a sentence.
//
// This is the readable face of the accountability trail — the thing an admin
// actually looks at when asking who changed what. It is worth testing for a
// reason that is not obvious: it renders values that came from *elsewhere*
// (entity types and reasons written by the backend), so the failure mode is
// not a crash, it is a row that quietly says nothing useful about a real
// event. "System updated undefined" is worse than no audit log, because it
// looks like an answer.
import { describe, expect, it } from 'vitest'
import { AUDIT_ENTITY_TYPES, describeAuditEntry, formatDateTime } from './auditLog'

const base = { user_full_name: 'Maryam', entity_id: 7, new_value: {} }

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

  it('describes every entity type the filter offers, without leaking a placeholder', () => {
    // The Audit Log tab lets an admin filter by each of these. Every one has
    // to produce a sentence, or filtering to it shows a list of nonsense.
    for (const entityType of AUDIT_ENTITY_TYPES) {
      const text = describeAuditEntry({ ...base, entity_type: entityType })
      expect(text, entityType).toBeTruthy()
      expect(text, entityType).not.toMatch(/undefined|null|\[object/)
    }
  })

  it('reads a user creation off the recorded username', () => {
    expect(
      describeAuditEntry({
        ...base, entity_type: 'User', new_value: { username: 'ali' },
      }),
    ).toBe('Maryam created user "ali" #7')
  })

  it('uses the recorded reason for a user change that has one', () => {
    expect(
      describeAuditEntry({
        ...base, entity_type: 'User', reason: "User 'ali' deactivated",
      }),
    ).toBe("Maryam user 'ali' deactivated")
  })

  it('totals a data wipe rather than listing every table', () => {
    const text = describeAuditEntry({
      ...base,
      entity_type: 'CpmDataWipe',
      entity_id: null,
      new_value: { sites: 10, work_items: 20, villages: 5 },
    })
    expect(text).toContain('35 records removed')
  })

  it('distinguishes the three things that happen to a work item', () => {
    const wi = (module, new_value) =>
      describeAuditEntry({ ...base, entity_type: 'WorkItem', module, new_value })

    expect(wi('HealthCheck', { status: 'Problematic' })).toContain('health check')
    expect(wi('Assignment', { contractor_id: 3 })).toContain('assigned')
    expect(wi('DriveTest', {})).toContain('drive test')
  })

  it('includes why a site was returned, which is the point of recording it', () => {
    expect(
      describeAuditEntry({
        ...base,
        entity_type: 'WorkItem',
        module: 'Assignment',
        new_value: { returned: true, reason: 'Road blocked by snow' },
      }),
    ).toContain('Road blocked by snow')
  })

  it('renders an em dash rather than undefined for a missing value', () => {
    expect(
      describeAuditEntry({ ...base, entity_type: 'Acceptance', new_value: {} }),
    ).toBe('Maryam updated an acceptance record #7 (ICT: —, CRA: —)')
  })

  it('falls back to something readable for an entity type it has never seen', () => {
    // The backend can add an entity type without the frontend knowing. It must
    // still produce a sentence naming the actor.
    const text = describeAuditEntry({ ...base, entity_type: 'SomeFutureThing' })
    expect(text).toBe('Maryam updated SomeFutureThing #7')
  })

  it('omits the id when there is not one', () => {
    expect(
      describeAuditEntry({ ...base, entity_type: 'WorkItem', entity_id: null }),
    ).not.toContain('#')
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
