import { describe, expect, it } from 'vitest'
import { appCount, appsFor, locate, pageCount, queueCounts } from './appRegistry'

const ids = (apps) => apps.map((a) => a.id)

describe('app registry role filtering', () => {
  it('never shows a contractor PM-only apps or pages', () => {
    const apps = appsFor('Contractor')
    expect(ids(apps)).not.toContain('data')
    expect(ids(apps)).not.toContain('admin')
    const dt = apps.find((a) => a.id === 'drive-test')
    expect(dt.pages.map((p) => p.id)).toEqual(['hc-check', 'in-progress', 'all-sites'])
  })

  it('gives Admin only the platform apps', () => {
    expect(ids(appsFor('Admin'))).toEqual(['data', 'admin'])
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

  it('My work counts everything waiting, once', () => {
    const myWork = appsFor('PM').find((a) => a.id === 'my-work')
    expect(appCount(myWork, counts)).toBe(9)
  })
})
