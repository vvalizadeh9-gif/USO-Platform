import { describe, expect, it } from 'vitest'
import { appsFor } from './appRegistry'
import {
  MAX_PAGE_HITS,
  buildGroups,
  fallbackRoute,
  flattenRows,
  isSearchable,
  searchPages,
  stepIndex,
} from './globalSearch'

const pm = appsFor('PM')
const contractor = appsFor('Contractor')

const SERVER = [
  {
    key: 'sites',
    label: 'Sites',
    total: 212,
    items: [
      { id: 7, title: 'KRM-1', subtitle: 'New · Kerman', route: '/work-items/7' },
      { id: 8, title: 'KRM-2', subtitle: 'New · Kerman', route: '/work-items/8' },
    ],
  },
  { key: 'contractors', label: 'Contractors', total: 1, items: [{ id: 3, title: 'Acme', subtitle: 'Their sites', route: '/work-items?contractor_id=3' }] },
]

describe('isSearchable', () => {
  it.each([['', false], [' ', false], ['a', false], [' a ', false], ['ab', true], [' ab ', true]])('%j is %s', (q, ok) => {
    expect(isSearchable(q)).toBe(ok)
  })
})

describe('searchPages', () => {
  it('finds a page by its label and says which app it is in', () => {
    const hits = searchPages(pm, 'lifecycle')
    expect(hits.map((h) => h.title)).toContain('Lifecycle gaps')
    const gaps = hits.find((h) => h.title === 'Lifecycle gaps')
    expect(gaps.subtitle).toBe('Insights')
    expect(gaps.route).toBe('/reports/gaps')
    expect(gaps.state).toEqual({ app: 'insights' })
  })

  it('finds an app by name, ahead of its pages', () => {
    const hits = searchPages(pm, 'acceptance')
    expect(hits[0].id).toBe('app:acceptance')
  })

  it('ignores case', () => {
    expect(searchPages(pm, 'MONTHLY')).toEqual(searchPages(pm, 'monthly'))
  })

  it('offers only the pages this role can open', () => {
    expect(searchPages(contractor, 'import')).toEqual([])
    expect(searchPages(contractor, 'audit')).toEqual([])
  })

  it('says nothing for a query too short to mean anything', () => {
    expect(searchPages(pm, 'a')).toEqual([])
  })

  it('is capped', () => {
    expect(searchPages(pm, 'ta').length).toBeLessThanOrEqual(MAX_PAGE_HITS)
  })
})

describe('buildGroups', () => {
  it('puts pages first, then what the server found, in its order', () => {
    const keys = buildGroups(pm, 'dashboard', SERVER).map((g) => g.key)
    expect(keys).toEqual(['pages', 'sites', 'contractors'])
  })

  it('leaves out an empty pages group', () => {
    expect(buildGroups(pm, 'zzzz', SERVER).map((g) => g.key)).toEqual(['sites', 'contractors'])
  })

  it('namespaces ids so a site 7 and a village 7 are different rows', () => {
    const ids = flattenRows(buildGroups([], 'kr', [
      { key: 'sites', label: 'Sites', total: 1, items: [{ id: 7, title: 'a', subtitle: '', route: '/a' }] },
      { key: 'villages', label: 'Villages', total: 1, items: [{ id: 7, title: 'b', subtitle: '', route: '/b' }] },
    ])).map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('offers "see all" only where there is more than shown and a page for it', () => {
    const groups = buildGroups([], 'kr m', SERVER)
    expect(groups.find((g) => g.key === 'sites').seeAll).toBe('/work-items?q=kr%20m')
    // Complete (1 of 1) and no list page: neither gets one.
    expect(groups.find((g) => g.key === 'contractors').seeAll).toBeNull()
  })
})

describe('flattenRows', () => {
  it('lists each group\'s results, then its "see all", top to bottom', () => {
    const rows = flattenRows(buildGroups([], 'kr', SERVER))
    expect(rows.map((r) => [r.kind, r.route])).toEqual([
      ['result', '/work-items/7'],
      ['result', '/work-items/8'],
      ['all', '/work-items?q=kr'],
      ['result', '/work-items?contractor_id=3'],
    ])
  })
})

describe('fallbackRoute', () => {
  it('opens the first result when there is one', () => {
    const rows = flattenRows(buildGroups(pm, 'dashboard', SERVER))
    expect(fallbackRoute(rows, 'dashboard').route).toBe(rows[0].route)
  })

  it('searches all sites when nothing matched', () => {
    expect(fallbackRoute([], ' xyz ')).toEqual({ route: '/work-items?q=xyz', state: undefined })
  })
})

describe('stepIndex', () => {
  it('starts at the top going down and at the bottom going up', () => {
    expect(stepIndex(-1, 4, 1)).toBe(0)
    expect(stepIndex(-1, 4, -1)).toBe(3)
  })

  it('wraps at both ends', () => {
    expect(stepIndex(3, 4, 1)).toBe(0)
    expect(stepIndex(0, 4, -1)).toBe(3)
  })

  it('has nowhere to go in an empty list', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1)
  })
})
