// The arithmetic the Gap & Performance page does in the browser.
//
// The checksum is the reason this file exists. It is the page's answer to a bug
// that shipped in the design preview — a 2,570 country figure beside an owner
// list adding to 445 — so the cases that matter most here are the ones where
// the sum does *not* balance, and what the page says when it doesn't.
import { describe, expect, it } from 'vitest'
import {
  MAX_ADDENDS,
  barScale,
  checksum,
  decorate,
  rateFraction,
  stretchShort,
  workedExample,
} from './gapRoad'

const owner = (name, stopped, reached = 400) => ({
  name,
  attribution: 'owned',
  villages: reached,
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
})

// 290 + 240 + 180 + 230 = 940, the worked example in the brief.
const OWNERS = [owner('Amir', 290), owner('Zohreh', 240), owner('Hossein', 230), owner('Farid', 180)]

const stretch = (over = {}) => ({
  key: 'cra',
  label: 'CRA approval',
  start: 'ICT approved',
  end: 'CRA approved',
  available: true,
  country: { stopped: 940, reached: 1300, rate: 72.3 },
  owners: OWNERS,
  ...over,
})

describe('decorate', () => {
  it('divides % of gap by the country total, so a full list sums to 100%', () => {
    const rows = decorate(OWNERS, 940)
    const total = rows.reduce((sum, row) => sum + row.shareOfGap, 0)
    expect(Math.round(total)).toBe(100)
    expect(rows[0].shareOfGap).toBeCloseTo(30.85, 2)
  })

  it('divides the running total by the visible rows, not by the country', () => {
    // A scoped viewer sees one row. Its share of the national gap is small;
    // its share of what it can see is all of it. Mixing the two bases would
    // tell that reader they are 100% of the country's problem.
    const rows = decorate([owner('Amir', 290)], 940)
    expect(rows[0].shareOfGap).toBeCloseTo(30.85, 2)
    expect(rows[0].cumulative).toBe(100)
  })

  it('marks the row that takes the running total past 80%', () => {
    const rows = decorate(OWNERS, 940)
    // 290 (30.9%), 530 (56.4%), 760 (80.9%) ← crosses here, 940 (100%)
    expect(rows.map((row) => row.pareto)).toEqual([false, false, true, false])
  })

  it('marks nothing when no owner is stopped anywhere', () => {
    const rows = decorate([owner('Amir', 0), owner('Zohreh', 0)], 0)
    expect(rows.some((row) => row.pareto)).toBe(false)
    expect(rows[0].shareOfGap).toBeNull()
  })
})

describe('checksum', () => {
  it('prints the addition in full against the country total', () => {
    const result = checksum(decorate(OWNERS, 940), stretch(), {
      plural: 'Coordinators',
      scoped: false,
    })
    expect(result.ok).toBe(true)
    expect(result.text).toBe(
      'Coordinators below sum to the 940 stopped before CRA: 290 + 240 + 230 + 180 = 940.'
    )
  })

  it('says so loudly when the rows do not make the country figure', () => {
    // The shipped bug, reproduced: a country total from one place and an owner
    // list from another.
    const result = checksum(decorate(OWNERS, 2570), stretch({ country: { stopped: 2570, reached: 3000, rate: 85 } }), {
      plural: 'Coordinators',
      scoped: false,
    })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('= 940')
    expect(result.text).toContain('does not match the 2,570 country total')
    expect(result.text).toContain('a difference of 1,630')
    expect(result.text).toContain('do not act on this page')
  })

  it('claims no equality for a scoped reader, whose one row cannot balance', () => {
    const result = checksum(decorate([owner('Hossein', 230)], 940), stretch(), {
      plural: 'Coordinators',
      scoped: true,
    })
    expect(result.ok).toBe(true)
    expect(result.text).toBe(
      'Your row is 230 of the 940 stopped before CRA nationally — 24.5% of the national gap.'
    )
    expect(result.text).not.toContain('=')
  })

  it('abbreviates a long list into an addition that is still checkable', () => {
    const many = Array.from({ length: 20 }, (_, index) => owner(`P${index}`, 10))
    const result = checksum(decorate(many, 200), stretch({ country: { stopped: 200, reached: 400, rate: 50 } }), {
      plural: 'Provinces',
      scoped: false,
    })
    expect(result.ok).toBe(true)
    // Ten spelled out, the rest as one figure: 10 × 10 + 100 = 200.
    expect(result.text).toContain('+ 100 (10 more) = 200')
    expect(many.length).toBeGreaterThan(MAX_ADDENDS)
  })
})

describe('workedExample', () => {
  it('explains both fractions with the top row’s real numbers', () => {
    const rows = decorate(OWNERS, 940)
    const sentence = workedExample(rows, stretch())
    expect(sentence).toContain('Amir is stopped on 290 of the 400 villages')
    expect(sentence).toContain('reached ICT approved')
    expect(sentence).toContain('own rate of 72.5%')
    expect(sentence).toContain('30.9% of the 940 stopped')
  })

  it('says nothing rather than something wrong when nothing has reached the stretch', () => {
    expect(workedExample(decorate([owner('Amir', 0, 0)], 0), stretch())).toBeNull()
    expect(workedExample([], stretch())).toBeNull()
  })
})

describe('small helpers', () => {
  it('names a stretch the way a sentence about it reads', () => {
    expect(stretchShort(stretch())).toBe('CRA')
    expect(stretchShort(stretch({ label: 'ICT approval' }))).toBe('ICT')
    expect(stretchShort(stretch({ label: 'Depreciation' }))).toBe('Depreciation')
  })

  it('always states the fraction a rate came from', () => {
    expect(rateFraction(owner('Amir', 290))).toBe('290 of 400 reached')
  })

  it('scales the bars to the largest row', () => {
    expect(barScale(OWNERS)).toBe(290)
    expect(barScale([])).toBe(0)
  })
})
