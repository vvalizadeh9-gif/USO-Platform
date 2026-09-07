// Role labels and the category-owner list.
//
// The list is duplicated between here and app/core/deps.py by design -- the
// backend decides permissions from Role.is_category_owner, and this only
// shapes what the interface offers. Duplication that is deliberate still needs
// a test, because "deliberate" wears off and the two drifting apart means a
// user seeing a nav item that 403s, or not seeing one they can use.
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_OWNER_ROLES,
  REVIEW_AUTHORITY_ROLES,
  canReview,
  isCategoryOwner,
  roleLabel,
} from './roles'

// The role names seeded in app/core/bootstrap.py. Literal on purpose: if a
// name changes on the server, this fails rather than quietly disagreeing.
const SEEDED_ROLES = [
  'Admin', 'PM', 'Coordinator', 'RegionalManager', 'Contractor', 'Viewer',
  'CpgPower', 'CpgRolloutPM', 'ManagedService', 'NwgPlanning',
]

describe('roleLabel', () => {
  it('has a human label for every role the server seeds', () => {
    for (const role of SEEDED_ROLES) {
      expect(roleLabel(role), `label for ${role}`).toBeTruthy()
    }
  })

  it('expands the abbreviations rather than showing them raw', () => {
    expect(roleLabel('PM')).toBe('Project Manager')
    expect(roleLabel('Admin')).toBe('Administrator')
  })

  it('shows an unknown role by name instead of blank', () => {
    // A role added on the server before the frontend hears about it must
    // render as something, not as an empty cell in the users table.
    expect(roleLabel('SomeFutureRole')).toBe('SomeFutureRole')
  })
})

describe('isCategoryOwner', () => {
  it('recognises the four problem-category owners', () => {
    for (const role of CATEGORY_OWNER_ROLES) {
      expect(isCategoryOwner(role), role).toBe(true)
    }
    expect(CATEGORY_OWNER_ROLES).toHaveLength(4)
  })

  it('does not treat a staff role as a category owner', () => {
    for (const role of ['Admin', 'PM', 'Coordinator', 'Contractor', 'Viewer']) {
      expect(isCategoryOwner(role), role).toBe(false)
    }
  })

  it('is false for nothing at all, rather than throwing', () => {
    // This is called with user?.role?.name, which is undefined during the
    // first render after a reload.
    expect(isCategoryOwner(undefined)).toBe(false)
    expect(isCategoryOwner(null)).toBe(false)
  })
})

describe('canReview', () => {
  // Mirrors app/core/deps.py:require_review_authority. The interface may only
  // narrow what the server allows, never widen it -- offering a control the
  // server refuses is how an Admin came to be shown an assign bar that
  // answered 403.
  it('is exactly PM and Coordinator', () => {
    expect(REVIEW_AUTHORITY_ROLES).toEqual(['PM', 'Coordinator'])
  })

  it('admits both roles that share the lifecycle', () => {
    expect(canReview({ role: { name: 'PM' } })).toBe(true)
    expect(canReview({ role: { name: 'Coordinator' } })).toBe(true)
  })

  it('excludes Admin, who the server refuses on workflow writes', () => {
    expect(canReview({ role: { name: 'Admin' } })).toBe(false)
  })

  it('excludes contractors, viewers and category owners', () => {
    for (const name of ['Contractor', 'Viewer', 'RegionalManager', ...CATEGORY_OWNER_ROLES]) {
      expect(canReview({ role: { name } }), name).toBe(false)
    }
  })

  it('says no rather than throwing when there is no user yet', () => {
    expect(canReview(undefined)).toBe(false)
    expect(canReview(null)).toBe(false)
    expect(canReview({})).toBe(false)
  })
})
