import { describe, expect, it } from 'vitest'
import {
  barWidth,
  blocks,
  deltaTone,
  fmtDelta,
  landingTab,
  parseScopeValue,
  scopeValue,
  tabLabel,
  tabsFor,
} from './model'

const as = (name) => ({ role: { name } })

describe('tabs per role', () => {
  it.each([
    ['PM', ['month', 'area', 'performance', 'compare', 'map'], 'month'],
    ['Viewer', ['month', 'area', 'performance', 'compare', 'map'], 'month'],
    ['RegionalManager', ['area', 'performance', 'map'], 'area'],
    ['Coordinator', ['area', 'performance', 'map'], 'area'],
    ['Contractor', ['area', 'performance', 'map'], 'area'],
    ['Admin', [], null],
  ])('%s', (role, tabs, landing) => {
    expect(tabsFor(as(role))).toEqual(tabs)
    expect(landingTab(as(role))).toBe(landing)
  })

  it('calls the area and performance tabs "My ..." for people confined to their own', () => {
    expect(tabLabel(as('Coordinator'), 'area')).toBe('My area')
    expect(tabLabel(as('Contractor'), 'performance')).toBe('My performance')
    expect(tabLabel(as('PM'), 'area')).toBe('Area')
    expect(tabLabel(as('Viewer'), 'performance')).toBe('Performance')
  })
})

describe('deltas', () => {
  it('reads zero as ±0 and signs everything else', () => {
    expect(fmtDelta(0)).toBe('±0')
    expect(fmtDelta(3)).toBe('+3')
    expect(fmtDelta(-2)).toBe('−2')
    expect(fmtDelta(-1.25, ' pts')).toBe('−1.3 pts')
    expect(fmtDelta(null)).toBe('—')
  })

  it('inverts the colour where lower is better', () => {
    expect(deltaTone(2)).toBe('good')
    expect(deltaTone(-2)).toBe('bad')
    expect(deltaTone(2, true)).toBe('bad')
    expect(deltaTone(-2, true)).toBe('good')
    expect(deltaTone(0, true)).toBe('flat')
  })
})

describe('block row', () => {
  it('is ceil(max(now, ref) / per) blocks', () => {
    expect(blocks(23, 12, 5)).toHaveLength(5)
    expect(blocks(0, 0, 5)).toHaveLength(0)
  })

  it('fills this month, rings what is beyond last month, outlines the shortfall', () => {
    // 12 this month against 23 last month, 5 per block.
    expect(blocks(12, 23, 5).map((b) => b.kind)).toEqual(['done', 'done', 'done', 'short', 'short'])
    // 23 against 12: the blocks past 12 are ringed.
    expect(blocks(23, 12, 5).map((b) => b.kind)).toEqual(['done', 'done', 'done', 'beyond', 'beyond'])
  })

  it('fills a partial last block to its share', () => {
    const row = blocks(12, 0, 5)
    expect(row[2].fill).toBeCloseTo(0.4)
    expect(row[0].fill).toBe(1)
  })

  it('never rings anything when last month was not recorded', () => {
    expect(blocks(12, null, 5).every((b) => b.kind === 'done')).toBe(true)
  })
})

describe('owner bars and scopes', () => {
  it('scales a bar against the leader, at most 64px', () => {
    expect(barWidth(10, 10)).toBe(64)
    expect(barWidth(5, 10)).toBe(32)
    expect(barWidth(0, 0)).toBe(0)
  })

  it('round-trips a scope through one select value', () => {
    expect(scopeValue(null)).toBe('country')
    expect(parseScopeValue('rm:Pirayesh')).toEqual({ lens: 'rm', key: 'Pirayesh' })
    expect(parseScopeValue(scopeValue({ lens: 'contractor', key: 'A:B' })))
      .toEqual({ lens: 'contractor', key: 'A:B' })
  })
})
