import { describe, expect, it } from 'vitest'
import { appCount, appsFor, locate, pageCount, queueCounts } from './appRegistry'

const ids = (apps) => apps.map((a) => a.id)

describe('app registry role filtering', () => {
  it('never shows a contractor PM-only apps or pages', () => {
    const apps = appsFor('Contractor')
    expect(ids(apps)).not.toContain('data')
    expect(ids(apps)).not.toContain('admin')
    const dt = apps.find((a) => a.id === 'drive-test')
    expect(dt.pages.map((p) => p.id)).toEqual(['dashboard', 'hc-check', 'in-progress', 'all-sites'])
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
})
