// The three account states, as the interface understands them.
//
// This list is duplicated from the backend's app/core/user_status.py, which is
// a deliberate trade: the interface needs it to build a dropdown before it has
// asked the server anything. The cost of the duplication is that it can drift,
// and what these tests hold is the part that must not — that the set is
// exactly three, that only Active signs in, and that every state has both a
// pill and a sentence explaining when to choose it.
import { describe, expect, it } from 'vitest'
import {
  ACTIVE,
  INACTIVE,
  STATUS_HELP,
  STATUS_VERB,
  SUSPENDED,
  USER_STATUSES,
  canSignIn,
  statusPillClass,
} from './userStatus'

describe('the set of statuses', () => {
  it('is exactly the three the backend accepts', () => {
    expect(USER_STATUSES).toEqual([ACTIVE, INACTIVE, SUSPENDED])
  })

  it('spells them the way the API does', () => {
    // These strings are sent as-is and validated server-side, so a lower-case
    // "active" here is a 422 the user cannot do anything about.
    expect(USER_STATUSES).toEqual(['Active', 'Inactive', 'Suspended'])
  })
})

describe('who may sign in', () => {
  it('is Active and nothing else', () => {
    expect(canSignIn(ACTIVE)).toBe(true)
    expect(canSignIn(INACTIVE)).toBe(false)
    expect(canSignIn(SUSPENDED)).toBe(false)
  })

  it('refuses a status it has never heard of', () => {
    // Failing closed: a state the interface does not recognise must not be
    // rendered as one that can work.
    expect(canSignIn('Retired')).toBe(false)
    expect(canSignIn(undefined)).toBe(false)
  })
})

describe('how each status is presented', () => {
  it('gives every status a pill class', () => {
    for (const status of USER_STATUSES) {
      expect(statusPillClass(status), status).toMatch(/^pill-/)
    }
  })

  it('does not colour Suspended the same as Inactive', () => {
    // They are different decisions and must not look like the same one.
    expect(statusPillClass(SUSPENDED)).not.toBe(statusPillClass(INACTIVE))
  })

  it('falls back to a neutral pill rather than an unstyled cell', () => {
    expect(statusPillClass('Retired')).toBe('pill-dim')
  })

  it('explains when to choose each one', () => {
    // The difference between Inactive and Suspended is the entire reason there
    // are three states rather than two, and it is not evident from the words.
    for (const status of USER_STATUSES) {
      expect(STATUS_HELP[status], status).toBeTruthy()
    }
    expect(STATUS_HELP[INACTIVE]).not.toBe(STATUS_HELP[SUSPENDED])
  })

  it('gives every status a verb for the button that moves an account to it', () => {
    for (const status of USER_STATUSES) {
      expect(STATUS_VERB[status], status).toBeTruthy()
    }
    // "Deactivate" reads as an action where "Inactive" reads as a label.
    expect(STATUS_VERB[INACTIVE]).not.toBe(INACTIVE)
  })
})
