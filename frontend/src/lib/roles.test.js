// Role labels and the category-owner list.
//
// The list is duplicated between here and app/core/deps.py by design -- the
// backend decides permissions from Role.is_category_owner, and this only
// shapes what the interface offers. Duplication that is deliberate still needs
// a test, because "deliberate" wears off and the two drifting apart means a
// user seeing a nav item that 403s, or not seeing one they can use.
import { describe, expect, it } from 'vitest'
import { userWithAccess } from '../test/seededAccess'
import {
  CATEGORY_OWNER_ROLES,
  canDecidePlans,
  canOpenMonthlyPlan,
  canReview,
  homeFor,
  isCategoryOwner,
  roleLabel,
} from './roles'

// UEP-25: these helpers read user.access (GET /me/access). `as` gives a role
// the access it has on day one, from the seed fixture.
const as = (name) => userWithAccess({ role: { name } })

// The role names seeded in app/core/bootstrap.py. Literal on purpose: if a
// name changes on the server, this fails rather than quietly disagreeing.
const SEEDED_ROLES = [
  'Admin', 'PM', 'Coordinator', 'RegionalManager', 'Contractor', 'Viewer',
  'CpgPower', 'CpgRolloutPM', 'ManagedService', 'NwgPlanning', 'HuaweiCleanup',
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
  it('recognises every problem-category owner the server seeds', () => {
    for (const role of CATEGORY_OWNER_ROLES) {
      expect(isCategoryOwner(role), role).toBe(true)
    }
    // Five since Huawei Cleanup joined. Pinned to a literal rather than a
    // count so adding an owner role fails here loudly, which is the point:
    // this list and app/core/deps.py:CATEGORY_OWNER_ROLES must agree, or a
    // team gets a nav item that 403s, or none at all.
    expect(CATEGORY_OWNER_ROLES).toEqual([
      'CpgPower', 'CpgRolloutPM', 'ManagedService', 'NwgPlanning', 'HuaweiCleanup',
    ])
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
  // The hc_work feature at Edit: PM and Coordinator on day one, as the
  // server's require_access(hc_work, edit). The interface may only narrow
  // what the server allows, never widen it.
  it('admits both roles that share the lifecycle', () => {
    expect(canReview(as('PM'))).toBe(true)
    expect(canReview(as('Coordinator'))).toBe(true)
  })

  it('excludes Admin, who reads health checks but does no workflow writes', () => {
    expect(canReview(as('Admin'))).toBe(false)
  })

  it('excludes contractors, viewers and category owners', () => {
    for (const name of ['Contractor', 'Viewer', 'RegionalManager', ...CATEGORY_OWNER_ROLES]) {
      expect(canReview(as(name)), name).toBe(false)
    }
  })

  it('follows a grant made in Admin › Access', () => {
    expect(canReview({ role: { name: 'Viewer' }, access: { features: { hc_work: 'edit' } } })).toBe(true)
  })

  it('says no rather than throwing when there is no user yet', () => {
    expect(canReview(undefined)).toBe(false)
    expect(canReview(null)).toBe(false)
    expect(canReview({})).toBe(false)
  })
})

describe('who the monthly plan is offered to', () => {
  it('is the contractor and the queue readers', () => {
    for (const role of ['Contractor', 'PM', 'Coordinator', 'Viewer']) {
      expect(canOpenMonthlyPlan(as(role)), role).toBe(true)
    }
  })

  it('is not offered to a Regional Manager', () => {
    expect(canOpenMonthlyPlan(as('RegionalManager'))).toBe(false)
  })

  // Admin may read the queue's API by URL but is not offered the page:
  // deciding a contractor's target is an operational act.
  it('is not offered to Admin', () => {
    expect(canOpenMonthlyPlan(as('Admin'))).toBe(false)
  })

  it('is not offered to a category owner', () => {
    for (const role of CATEGORY_OWNER_ROLES) expect(canOpenMonthlyPlan(as(role)), role).toBe(false)
  })

  it('gives the decision to the PM alone', () => {
    expect(canDecidePlans(as('PM'))).toBe(true)
    for (const role of ['Admin', 'Coordinator', 'RegionalManager', 'Viewer', 'Contractor']) {
      expect(canDecidePlans(as(role)), role).toBe(false)
    }
    expect(canDecidePlans(undefined)).toBe(false)
  })
})

describe('homeFor', () => {
  it('keeps the built-in start pages', () => {
    expect(homeFor(as('Admin'))).toBe('/admin')
    expect(homeFor(as('Viewer'))).toBe('/reports/kpi')
    expect(homeFor(as('PM'))).toBe('/home')
  })

  it('follows an app-route landing set in Admin › Access', () => {
    const cpo = { role: { name: 'CPO' }, access: { ...as('Viewer').access, role: 'CPO', landing: '/explorer' } }
    expect(homeFor(cpo)).toBe('/explorer')
  })
})
