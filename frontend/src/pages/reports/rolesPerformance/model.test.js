import { describe, expect, it } from 'vitest'
import {
  fmtGap,
  gapPoints,
  isFutureMonth,
  landingTab,
  ownerColumn,
  parseMonthParam,
  parseScopeValue,
  rankLabel,
  rankRows,
  scopeValue,
  tabLabel,
  tabSearch,
  tabsFor,
} from './model'

const as = (name) => ({ role: { name } })

describe('tabs per role', () => {
  it.each([
    ['PM', ['month', 'area', 'map'], 'month'],
    ['Viewer', ['month', 'area', 'map'], 'month'],
    ['RegionalManager', ['area', 'map'], 'area'],
    ['Coordinator', ['area', 'map'], 'area'],
    ['Contractor', ['area', 'map'], 'area'],
    ['Admin', [], null],
  ])('%s', (role, tabs, landing) => {
    expect(tabsFor(as(role))).toEqual(tabs)
    expect(landingTab(as(role))).toBe(landing)
  })

  it('calls Area "My area" for people confined to their own', () => {
    expect(tabLabel(as('Coordinator'), 'area')).toBe('My area')
    expect(tabLabel(as('PM'), 'area')).toBe('Area')
  })

  it('carries the scope to Area only, and nothing else', () => {
    expect(tabSearch('area', '?lens=rm&key=X&measure=dt')).toBe('?lens=rm&key=X')
    expect(tabSearch('month', '?lens=rm&key=X')).toBe('')
    expect(tabSearch('area', '')).toBe('')
  })
})

describe('owner columns', () => {
  const entries = [
    { name: 'A', now: 6 }, { name: 'B', now: 3 }, { name: 'C', now: 1 },
    { name: 'D', now: 0 }, { name: 'E', now: 0 }, { name: 'Unattributed', now: 2 },
  ]

  it('colours the top two only, and puts Unattributed last', () => {
    const { listed } = ownerColumn(entries, 12)
    expect(listed.map((o) => [o.name, o.rank])).toEqual([
      ['A', 1], ['B', 2], ['C', 'rest'], ['Unattributed', 'none'],
    ])
  })

  it('collapses owners with none, and the top two share', () => {
    const { none, topTwo } = ownerColumn(entries, 12)
    expect(none).toEqual(['D', 'E'])
    expect(topTwo).toBe(75)
  })

  it('adds up to the total', () => {
    const { listed } = ownerColumn(entries, 12)
    expect(listed.reduce((sum, o) => sum + o.count, 0)).toBe(12)
  })
})

describe('the ranking against national', () => {
  const row = (name, rate, low = false) => ({
    name, low_sample: low, measures: { full: { count: 1, rate } },
  })

  it('puts the furthest behind first, ties by name, not-compared last', () => {
    const { compared, low, behind } = rankRows(
      [row('Yazd', 60), row('Qom', 40), row('Ilam', 40), row('Zanjan', 10, true), row('Fars', 51)],
      'full', 51,
    )
    expect(compared.map((r) => r.name)).toEqual(['Ilam', 'Qom', 'Fars', 'Yazd'])
    expect(compared.map((r) => r.gap)).toEqual([-11, -11, 0, 9])
    expect(low.map((r) => r.name)).toEqual(['Zanjan'])
    expect(behind).toBe(2)
  })

  it('writes the gap signed, red only when worse', () => {
    expect(fmtGap(gapPoints(40, 51))).toEqual({ text: '−11 pts', tone: 'worse' })
    expect(fmtGap(4)).toEqual({ text: '+4 pts', tone: 'better' })
    expect(fmtGap(0)).toEqual({ text: '±0', tone: 'flat' })
  })

  it('labels a bar in words', () => {
    expect(rankLabel('Qazvin', 40, 51)).toBe('Qazvin 40%, national 51%, 11 points behind')
  })
})

describe('months and scopes', () => {
  it('disables only months after the running one', () => {
    const current = { year: 1405, month: 7 }
    expect(isFutureMonth({ year: 1405, month: 8 }, current)).toBe(true)
    expect(isFutureMonth({ year: 1405, month: 7 }, current)).toBe(false)
    expect(isFutureMonth({ year: 1404, month: 12 }, current)).toBe(false)
  })

  it('reads ?month=', () => {
    expect(parseMonthParam('1405-06')).toEqual({ year: 1405, month: 6 })
    expect(parseMonthParam('1405-13')).toBeNull()
    expect(parseMonthParam(null)).toBeNull()
  })

  it('round-trips a scope through one select value', () => {
    expect(scopeValue(null)).toBe('country')
    expect(parseScopeValue('rm:Pirayesh')).toEqual({ lens: 'rm', key: 'Pirayesh' })
    expect(parseScopeValue(scopeValue({ lens: 'contractor', key: 'A:B' })))
      .toEqual({ lens: 'contractor', key: 'A:B' })
  })
})
