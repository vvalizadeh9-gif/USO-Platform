import { describe, expect, it } from 'vitest'
import { appCount, appRoute, appsFor, locate, pageCount, queueCounts, queueLate } from './appRegistry'

const ids = (apps) => apps.map((a) => a.id)

describe('app registry role filtering', () => {
  it('never shows a contractor PM-only apps or pages', () => {
    const apps = appsFor('Contractor')
    expect(ids(apps)).not.toContain('data')
    expect(ids(apps)).not.toContain('admin')
    const dt = apps.find((a) => a.id === 'drive-test')
    expect(dt.pages.map((p) => p.id)).toEqual(['hc-check', 'in-progress'])
  })

  it('lists the Monthly plan pages in tab order, Plans first, staff-only past it', () => {
    const pm = appsFor('PM').find((a) => a.id === 'monthly-plan')
    expect(pm.pages.map((p) => p.label)).toEqual(['Plans', 'History', 'Internal PIP'])
    expect(pm.pages[0].queues).toContain('plans_approve')
    const contractor = appsFor('Contractor').find((a) => a.id === 'monthly-plan')
    expect(contractor.pages.map((p) => p.id)).toEqual(['plans'])
    expect(locate(appsFor('PM'), '/monthly-plan', '').page.id).toBe('plans')
    expect(locate(appsFor('PM'), '/monthly-plan', '?tab=approvals').page.id).toBe('plans')
    expect(locate(appsFor('PM'), '/monthly-plan', '?tab=history').page.id).toBe('history')
  })

  it('gives Admin only the platform apps', () => {
    expect(ids(appsFor('Admin'))).toEqual(['data', 'admin'])
  })

  it.each([
    ['/health-check', '', 'hc-assign'],
    ['/health-check', '?tab=assign', 'hc-assign'],
    ['/health-check', '?tab=checks', 'hc-checks'],
    ['/health-check', '?tab=remediation', 'remediation'],
    ['/health-check', '?tab=reroutes', 'remediation'],
    ['/drive-test', '', 'dt-assign'],
    ['/drive-test', '?tab=assign', 'dt-assign'],
    ['/drive-test', '?tab=tests', 'dt-tests'],
    ['/drive-test', '?tab=done', 'dt-tests'],
    ['/drive-test', '?tab=history', 'history'],
    ['/health-check', '?tab=history', 'history'],
  ])('lights the rail item of each pipeline step: %s%s → %s', (path, search, id) => {
    expect(locate(appsFor('Coordinator'), path, search).page.id).toBe(id)
  })

  it('locates the most specific page for a URL', () => {
    const { app, page } = locate(appsFor('PM'), '/drive-test', '?tab=tests')
    expect(app.id).toBe('drive-test')
    expect(page.id).toBe('dt-tests')
  })
})

describe('counts come from the one /me/home response', () => {
  const home = {
    groups: [
      { tickets: [{ queue_key: 'dt_review', count: 4 }, { queue_key: 'hc_review', count: 2 }] },
      { tickets: [{ queue_key: 'ict_pending', count: 3 }] },
    ],
  }
  const counts = queueCounts(home)

  it('a rail count equals the queue row it sums', () => {
    const dt = appsFor('PM').find((a) => a.id === 'drive-test')
    expect(pageCount(dt.pages.find((p) => p.id === 'dt-tests'), counts)).toBe(4)
    expect(appCount(dt, counts)).toBe(6)
  })

  it('has no My work app', () => {
    expect(ids(appsFor('PM'))).not.toContain('my-work')
  })

  it('gives a category owner a Drive test rail of exactly the Fix queue', () => {
    const dt = appsFor('CpgPower').find((a) => a.id === 'drive-test')
    expect(dt.pages.map((p) => p.id)).toEqual(['fixes'])
    expect(appsFor('PM').find((a) => a.id === 'drive-test').pages.map((p) => p.id)).not.toContain('fixes')
  })

  it('keeps the Acceptance dashboard under Insights only (UEP-16)', () => {
    const apps = appsFor('PM')
    expect(locate(apps, '/reports/acceptance', '').app.id).toBe('insights')
    expect(locate(apps, '/reports/acceptance', '', 'acceptance').app.id).toBe('insights')
    const insights = apps.find((a) => a.id === 'insights')
    expect(insights.pages.map((p) => p.id)).toContain('acceptance-dashboard')
  })

  it('ignores a preferred app that does not hold the page', () => {
    expect(locate(appsFor('PM'), '/my-work', '', 'insights').app.id).toBe('acceptance')
  })
})

// UEP-11 Part A: the Drive Test dashboard left the Drive test rail. It is
// still Insights › Dashboards, and the app opens on its first queue.
describe('Drive test rail without Dashboard', () => {
  it.each(['PM', 'Coordinator', 'Contractor', 'RegionalManager', 'Viewer', 'CpgPower'])(
    'has no Dashboard for %s',
    (role) => {
      // RM and Viewer had only Explorer here; with Explorer its own app the
      // Drive test app is not theirs at all.
      const dt = appsFor(role).find((a) => a.id === 'drive-test')
      expect((dt?.pages ?? []).map((p) => p.route)).not.toContain('/reports/drive-test')
    },
  )

  it.each([
    ['PM', '/health-check?tab=assign'],
    ['Coordinator', '/health-check?tab=assign'],
    ['Contractor', '/my-health-check'],
    ['CpgPower', '/my-fix-queue'],
  ])('opens the app for %s on its first remaining page', (role, route) => {
    const dt = appsFor(role).find((a) => a.id === 'drive-test')
    expect(appRoute(dt)).toBe(route)
    expect(appRoute(dt)).toBe(dt.pages[0].route)
  })

  it('still offers the dashboard under Insights › Dashboards, and the URL lands there', () => {
    const apps = appsFor('PM')
    const insights = apps.find((a) => a.id === 'insights')
    expect(insights.pages.find((p) => p.id === 'dashboards').route).toBe('/reports/drive-test')
    expect(locate(apps, '/reports/drive-test', '').app.id).toBe('insights')
    expect(locate(apps, '/reports/drive-test', '', 'drive-test').app.id).toBe('insights')
  })

  it('makes Explorer its own app, first in Rollout, for the Drive test roles only', () => {
    for (const role of ['PM', 'Coordinator', 'Contractor', 'RegionalManager', 'Viewer']) {
      const apps = appsFor(role)
      const rollout = apps.filter((a) => a.group === 'rollout')
      expect(rollout[0]).toMatchObject({ id: 'explorer', name: 'Explorer', icon: 'search--locate' })
      expect(rollout[0].pages).toEqual([expect.objectContaining({ label: 'Explorer', route: '/explorer' })])
      expect((apps.find((a) => a.id === 'drive-test')?.pages ?? []).map((p) => p.id)).not.toContain('explorer')
    }
    expect(ids(appsFor('CpgPower'))).not.toContain('explorer')
    expect(locate(appsFor('PM'), '/explorer/sites/7', '').app.id).toBe('explorer')
  })

  it('labels and orders the Insights rail', () => {
    const insights = appsFor('PM').find((a) => a.id === 'insights')
    expect(insights.pages.map((p) => p.label)).toEqual([
      'Drive test dashboard', 'Acceptance dashboard', 'Roles performance', 'Lifecycle gaps', 'Exports',
    ])
  })
})

// UEP-16: the Acceptance rail is Filing, ICT validation and CRA validation.
describe('Acceptance rail', () => {
  const pagesOf = (role) => appsFor(role).find((a) => a.id === 'acceptance')?.pages.map((p) => p.id)

  it.each(['PM', 'Coordinator'])('gives %s Filing and both validation pages', (role) => {
    expect(pagesOf(role)).toEqual(['filing', 'ict-validation', 'cra-validation'])
  })

  it.each(['Contractor', 'RegionalManager', 'Viewer'])('gives %s Filing only', (role) => {
    expect(pagesOf(role)).toEqual(['filing'])
  })

  it('opens on Filing and has no Dashboard or Letters', () => {
    const app = appsFor('PM').find((a) => a.id === 'acceptance')
    expect(appRoute(app)).toBe('/my-work')
    expect(app.pages.map((p) => p.route)).not.toContain('/reports/acceptance')
    expect(app.pages.map((p) => p.id)).not.toContain('letters')
  })

  it('colours each validation tile by its authority and counts one queue each', () => {
    const app = appsFor('Coordinator').find((a) => a.id === 'acceptance')
    const ict = app.pages.find((p) => p.id === 'ict-validation')
    const cra = app.pages.find((p) => p.id === 'cra-validation')
    expect([ict.tile, cra.tile]).toEqual(['--uep-ict', '--uep-cra'])
    const counts = { ict_to_validate: 12, cra_to_validate: 5, acceptance_filing: 30, ict_pending: 99 }
    expect(pageCount(ict, counts)).toBe(12)
    expect(pageCount(cra, counts)).toBe(5)
    expect(pageCount(app.pages[0], counts)).toBe(30)
    expect(locate(appsFor('Coordinator'), '/validation/cra', '').page.id).toBe('cra-validation')
  })

  it('reads rail-only tickets into the counts and the late figures', () => {
    const home = {
      groups: [{ tickets: [{ queue_key: 'ict_to_validate', count: 3, late: 1 }] }],
      rail_tickets: [{ queue_key: 'acceptance_filing', count: 8, late: 2 }],
    }
    expect(queueCounts(home)).toEqual({ ict_to_validate: 3, acceptance_filing: 8 })
    expect(queueLate(home)).toEqual({ ict_to_validate: 1, acceptance_filing: 2 })
  })
})
