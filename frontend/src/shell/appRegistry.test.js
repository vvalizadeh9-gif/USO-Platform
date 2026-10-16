import { describe, expect, it } from 'vitest'
import { appCount, appRoute, appsFor, locate, pageCount, queueCounts } from './appRegistry'

const ids = (apps) => apps.map((a) => a.id)

describe('app registry role filtering', () => {
  it('never shows a contractor PM-only apps or pages', () => {
    const apps = appsFor('Contractor')
    expect(ids(apps)).not.toContain('data')
    expect(ids(apps)).not.toContain('admin')
    const dt = apps.find((a) => a.id === 'drive-test')
    expect(dt.pages.map((p) => p.id)).toEqual(['hc-check', 'in-progress'])
  })

  it('lists the Monthly plan pages in tab order, Approvals first, staff-only past it', () => {
    const pm = appsFor('PM').find((a) => a.id === 'monthly-plan')
    expect(pm.pages.map((p) => p.label)).toEqual(['Approvals', 'Plans', 'History', 'Internal PIP'])
    expect(pm.pages[0].queues).toContain('plans_approve')
    const contractor = appsFor('Contractor').find((a) => a.id === 'monthly-plan')
    expect(contractor.pages.map((p) => p.id)).toEqual(['approvals'])
    expect(locate(appsFor('PM'), '/monthly-plan', '').page.id).toBe('approvals')
    expect(locate(appsFor('PM'), '/monthly-plan', '?tab=approvals').page.id).toBe('approvals')
    expect(locate(appsFor('PM'), '/monthly-plan', '?tab=history').page.id).toBe('history')
  })

  it('gives Admin only the platform apps', () => {
    expect(ids(appsFor('Admin'))).toEqual(['data', 'admin'])
  })

  it.each([
    ['/health-check', '', 'hc-pool'],
    ['/health-check', '?tab=pool&state=ready', 'hc-pool'],
    ['/health-check', '?tab=running', 'hc-pool'],
    ['/health-check', '?tab=remediation', 'hc-pool'],
    ['/health-check', '?tab=reroutes', 'hc-pool'],
    ['/health-check', '?tab=review', 'hc-review'],
    ['/health-check', '?tab=results', 'hc-review'],
    ['/drive-test', '', 'assignment'],
    ['/drive-test', '?tab=in-progress', 'assignment'],
    ['/drive-test', '?tab=sent-back', 'assignment'],
    ['/drive-test', '?tab=review', 'dt-review'],
  ])('lights the rail item of each pipeline step: %s%s → %s', (path, search, id) => {
    expect(locate(appsFor('Coordinator'), path, search).page.id).toBe(id)
  })

  it('lights no work item for History or DT done', () => {
    expect(locate(appsFor('PM'), '/health-check', '?tab=history').page).toBeNull()
    expect(locate(appsFor('PM'), '/drive-test', '?tab=done').page).toBeNull()
  })

  it('locates the most specific page for a URL', () => {
    const { app, page } = locate(appsFor('PM'), '/drive-test', '?tab=review')
    expect(app.id).toBe('drive-test')
    expect(page.id).toBe('dt-review')
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
    expect(pageCount(dt.pages.find((p) => p.id === 'dt-review'), counts)).toBe(4)
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

  it('keeps the shared Acceptance dashboard in the app the user opened', () => {
    const apps = appsFor('PM')
    expect(locate(apps, '/reports/acceptance', '').app.id).toBe('acceptance')
    expect(locate(apps, '/reports/acceptance', '', 'acceptance').page.id).toBe('dashboard')
    const insights = locate(apps, '/reports/acceptance', '', 'insights')
    expect(insights.app.id).toBe('insights')
    expect(insights.app.pages.map((p) => p.id)).toEqual(expect.arrayContaining(['roles', 'gaps']))
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
    ['PM', '/health-check?tab=pool'],
    ['Coordinator', '/health-check?tab=pool'],
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
