// What a person may use comes from GET /me/access (UEP-25). These tests cover
// the helpers that read it, and -- through the day-one seed fixture -- that the
// interface offers each built-in role exactly what it offered before. The
// backend's tests/test_feature_access.py proves the server's tables equal the
// same fixture.
import { describe, expect, it } from 'vitest'
import { seededAccess, userWithAccess } from '../test/seededAccess'
import { AREA, FEATURE, can, canAccess, isException, isOffered, landingFor, levelOf, meets } from './access'

const CORE = ['PM', 'Coordinator', 'Viewer', 'Contractor']
const FIVE = ['NwgPlanning', 'ManagedService', 'HuaweiCleanup', 'CpgPower', 'CpgRolloutPM']
const RM = 'RegionalManager'
const as = (role) => userWithAccess({ role: { name: role } })

// role -> area -> offered (true) or not (false): the pre-UEP-25 matrix.
const MATRIX = {
  PM: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false, submissions: true, acceptance_cases: true, acceptance_baskets: true },
  Coordinator: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false, submissions: true, acceptance_cases: true, acceptance_baskets: true },
  Viewer: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false, submissions: true, acceptance_cases: true, acceptance_baskets: true },
  Contractor: { roles_performance: true, lifecycle_gaps: true, mojri_section: false, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: false, submissions: false, acceptance_cases: true, acceptance_baskets: false },
  RegionalManager: { roles_performance: true, lifecycle_gaps: true, mojri_section: false, insights_dashboards: false, explorer: true, acceptance_workspace: false, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: false, submissions: false, acceptance_cases: false, acceptance_baskets: false },
  ...Object.fromEntries(FIVE.map((role) => [role, {
    roles_performance: false, lifecycle_gaps: false, mojri_section: false, insights_dashboards: false, explorer: true, acceptance_workspace: false, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: true, submissions: false,
    // UEP-22: the team basket roles work Filing; Huawei cleanup has no basket.
    acceptance_cases: role !== 'HuaweiCleanup', acceptance_baskets: false,
  }])),
}

describe('day one: each built-in role is offered what it was before', () => {
  const cases = Object.entries(MATRIX).flatMap(([role, areas]) =>
    Object.entries(areas).map(([area, offered]) => [role, area, offered]))

  it.each(cases)('%s × %s → %s', (role, area, offered) => {
    expect(isOffered(as(role), area)).toBe(offered)
    expect(canAccess(as(role), area)).toBe(offered)
  })

  it('lets Admin use the dashboards, Explorer and the plan queue by URL without offering them', () => {
    for (const area of [AREA.INSIGHTS_DASHBOARDS, AREA.EXPLORER, AREA.MONTHLY_PLAN_QUEUE]) {
      expect(isOffered(as('Admin'), area)).toBe(false)
      expect(canAccess(as('Admin'), area)).toBe(true)
    }
    expect(canAccess(as('Admin'), AREA.ROLES_PERFORMANCE)).toBe(false)
  })

  it('gives Admin no workflow edit feature', () => {
    for (const f of [FEATURE.HC_WORK, FEATURE.DT_REVIEW, FEATURE.ACCEPTANCE_FILING, FEATURE.PLAN_APPROVALS]) {
      expect(can(as('Admin'), f, 'edit')).toBe(false)
    }
  })
})

describe('levels', () => {
  const user = { access: { features: { explorer: 'view', hc_work: 'edit' }, hidden_in_menus: [], exceptions: ['explorer'] } }

  it('orders none < view < edit', () => {
    expect(can(user, 'hc_work', 'view')).toBe(true)
    expect(can(user, 'hc_work', 'edit')).toBe(true)
    expect(can(user, 'explorer', 'edit')).toBe(false)
    expect(can(user, 'users')).toBe(false)
    expect(levelOf(user, 'users')).toBe('none')
  })

  it('reads an access object or a user alike, and no user as nothing', () => {
    expect(can(user.access, 'explorer')).toBe(true)
    expect(can(null, 'explorer')).toBe(false)
    expect(can({ role: { name: 'PM' } }, 'explorer')).toBe(false)
  })

  it('marks a personal exception', () => {
    expect(isException(user, 'explorer')).toBe(true)
    expect(isException(user, 'hc_work')).toBe(false)
  })

  it('reads a need as a feature, a [feature, level], any/all, or a function', () => {
    expect(meets(user, 'explorer')).toBe(true)
    expect(meets(user, ['explorer', 'edit'])).toBe(false)
    expect(meets(user, { any: ['users', ['hc_work', 'edit']] })).toBe(true)
    expect(meets(user, { all: ['users', 'explorer'] })).toBe(false)
    expect(meets(user, (u) => u === user)).toBe(true)
    expect(meets(user, undefined)).toBe(true)
  })

  it('leaves a feature hidden in menus out of the offered answer only', () => {
    const hidden = { access: { features: { explorer: 'view' }, hidden_in_menus: ['explorer'] } }
    expect(meets(hidden, 'explorer')).toBe(true)
    expect(meets(hidden, 'explorer', { offered: true })).toBe(false)
  })
})

describe('landings', () => {
  it('sends a Regional Manager to the region landing', () => {
    expect(landingFor(as(RM))).toBe('region')
  })

  it.each(FIVE)('sends %s to the work landing', (role) => {
    expect(landingFor(as(role))).toBe('work')
  })

  it.each([...CORE, 'Admin'])('keeps %s on the standard landing', (role) => {
    expect(landingFor(as(role))).toBe('standard')
  })

  it('follows an app-route landing from Admin › Access', () => {
    expect(landingFor({ access: { ...seededAccess('Viewer'), landing: '/explorer' } })).toBe('/explorer')
  })
})
