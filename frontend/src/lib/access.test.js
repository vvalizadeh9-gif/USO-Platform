// The central permission map: one assertion per role and area of the UEP
// role-access matrix. The backend's tests/test_access_matrix.py checks the
// same table from the server's copy, and that the two copies are identical.
import { describe, expect, it } from 'vitest'
import { AREA, allowedRoles, canAccess, isOffered, landingFor, offeredRoles } from './access'

const CORE = ['PM', 'Coordinator', 'Viewer', 'Contractor']
const FIVE = ['NwgPlanning', 'ManagedService', 'HuaweiCleanup', 'CpgPower', 'CpgRolloutPM']
const RM = 'RegionalManager'

// role -> area -> offered (true) or not (false), straight from the matrix.
const MATRIX = {
  PM: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false },
  Coordinator: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false },
  Viewer: { roles_performance: true, lifecycle_gaps: true, mojri_section: true, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: true, internal_pip: true, explorer_all_sites: false },
  Contractor: { roles_performance: true, lifecycle_gaps: true, mojri_section: false, insights_dashboards: true, explorer: true, acceptance_workspace: true, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: false },
  RegionalManager: { roles_performance: true, lifecycle_gaps: true, mojri_section: false, insights_dashboards: false, explorer: true, acceptance_workspace: false, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: false },
  ...Object.fromEntries(FIVE.map((role) => [role, {
    roles_performance: false, lifecycle_gaps: false, mojri_section: false, insights_dashboards: false, explorer: true, acceptance_workspace: false, monthly_plan_queue: false, internal_pip: false, explorer_all_sites: true,
  }])),
}

describe('the access matrix', () => {
  const cases = Object.entries(MATRIX).flatMap(([role, areas]) =>
    Object.entries(areas).map(([area, offered]) => [role, area, offered]))

  it.each(cases)('%s × %s → %s', (role, area, offered) => {
    expect(isOffered(role, area)).toBe(offered)
    expect(canAccess(role, area)).toBe(offered)
  })

  it('names every area in AREA, and AREA names nothing else', () => {
    for (const area of Object.values(AREA)) expect(() => offeredRoles(area)).not.toThrow()
    expect(Object.keys(MATRIX.PM).sort()).toEqual(Object.values(AREA).sort())
  })

  it('throws on an unknown area rather than answering "nobody"', () => {
    expect(() => canAccess('PM', 'roles_perfromance')).toThrow(/Unknown access area/)
  })

  it('lets Admin use the dashboards, Explorer and the plan queue by URL without offering them', () => {
    for (const area of [AREA.INSIGHTS_DASHBOARDS, AREA.EXPLORER, AREA.MONTHLY_PLAN_QUEUE]) {
      expect(isOffered('Admin', area)).toBe(false)
      expect(canAccess('Admin', area)).toBe(true)
      expect(allowedRoles(area)).toContain('Admin')
    }
    expect(canAccess('Admin', AREA.ROLES_PERFORMANCE)).toBe(false)
  })
})

describe('landings', () => {
  it('sends a Regional Manager to the region landing', () => {
    expect(landingFor(RM)).toBe('region')
  })

  it.each(FIVE)('sends %s to the work landing', (role) => {
    expect(landingFor(role)).toBe('work')
  })

  it.each([...CORE, 'Admin'])('keeps %s on the standard landing', (role) => {
    expect(landingFor(role)).toBe('standard')
  })
})
