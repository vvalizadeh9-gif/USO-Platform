import { describe, expect, it } from 'vitest'
import {
  CARDS,
  GAPS,
  LENSES,
  checksum,
  dataNotes,
  drawerRows,
  exportDescription,
  gapShortName,
  hasData,
  holdersParts,
  mojriStamp,
  shareSentence,
  waffleFilled,
} from './lifecycleGaps'

const row = (name, count, base, attribution = 'owned') => ({ name, count, base, attribution })

describe('the cards', () => {
  it('puts ICT on the left and CRA on the right of every card', () => {
    for (const card of CARDS) {
      expect(card.gaps.map((key) => GAPS[key].authority)).toEqual(['ICT', 'CRA'])
    }
  })

  it('covers the six gaps once each', () => {
    expect(CARDS.flatMap((card) => card.gaps).sort()).toEqual(Object.keys(GAPS).sort())
  })

  it('offers the five lenses in the design order', () => {
    expect(LENSES.map((lens) => lens.key)).toEqual(['coordinator', 'contractor', 'province', 'region', 'rm'])
  })
})

describe('the waffle', () => {
  it('fills round(100 × gap ÷ base) squares', () => {
    expect(waffleFilled(1391, 4433)).toBe(31)
    expect(waffleFilled(2042, 4812)).toBe(42)
  })

  it('never fills below zero, above the whole, or on an empty base', () => {
    expect(waffleFilled(0, 4433)).toBe(0)
    expect(waffleFilled(5, 0)).toBe(0)
    expect(waffleFilled(900, 800)).toBe(100)
  })

  it('works for a strip of 20 as well as a grid of 100', () => {
    expect(waffleFilled(205, 1391, 20)).toBe(3)
  })

  it('says what a share is a share of, for the accessible name', () => {
    expect(shareSentence('pending_cra', { count: 575, base: 4433 })).toBe('13% of 4,433 drive-tested')
    expect(shareSentence('cra_remained', { count: 610, base: 2770 })).toBe('22% of 2,770 ICT-approved')
    expect(shareSentence('pending_ict', { count: 0, base: 0 })).toBe('— of 0 drive-tested')
    // The Mojri card's base is every approved village, not an on-air count.
    expect(GAPS.ict_missing_in_mojri.baseName).toBe('approved in UEP')
    expect(GAPS.cra_missing_in_mojri.baseName).toBe('approved in UEP')
  })
})

describe('Mojri', () => {
  it('has no data until Mojri has been imported', () => {
    expect(hasData('ict_missing_in_mojri', { last_mojri_import: null })).toBe(false)
    expect(hasData('ict_missing_in_mojri', { last_mojri_import: '2026-09-12' })).toBe(true)
    expect(hasData('pending_ict', { last_mojri_import: null })).toBe(true)
  })
})

describe('the drawer rows', () => {
  const rows = [row('A', 290, 400), row('B', 240, 500), row('C', 0, 600)]

  it('keeps every row, with its share of the gap and its 20-square mark', () => {
    const out = drawerRows(rows, 530)
    expect(out).toHaveLength(3)
    expect(out[0].share).toBeCloseTo(54.72, 2)
    expect(out[0].marks).toBe(11)
    expect(out[2].marks).toBe(0)
  })

  it('has no share when the gap is zero', () => {
    expect(drawerRows([row('A', 0, 10)], 0)[0].share).toBeNull()
  })

  it('counts the holders that hold any of it', () => {
    expect(holdersParts(rows, 'coordinator', 530)).toEqual({
      holders: '2',
      noun: 'coordinators',
      verb: 'hold',
      total: '530',
      villages: 'villages',
    })
    expect(holdersParts([row('A', 1, 1)], 'province', 1)).toMatchObject({
      noun: 'province',
      verb: 'holds',
      villages: 'village',
    })
  })
})

describe('the checksum', () => {
  const rows = [row('A', 290, 400), row('B', 240, 500), row('C', 410, 600)]

  it('says the rows add up when they do', () => {
    expect(checksum(rows, 940)).toEqual({ ok: true, sum: 940, text: 'Adds up to 940' })
  })

  it('says so loudly when they do not', () => {
    const result = checksum(rows, 2570)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('The rows add up to 940, not 2,570')
    expect(result.text).toContain('a difference of 1,630')
  })
})

describe('export descriptions', () => {
  it('names the gap, then the scope, then the owner', () => {
    expect(gapShortName('pending_cra')).toBe('CRA pending')
    expect(gapShortName('ict_missing_in_mojri')).toBe('ICT not in Mojri')
    expect(gapShortName('ict_approved')).toBe('ICT approved')
    expect(gapShortName('ict_approved_all')).toBe('ICT approved in UEP')
    expect(gapShortName('cra_approved_all')).toBe('CRA approved in UEP')
    expect(
      exportDescription({ gap: 'pending_cra', lens: 'coordinator', keyValue: 'V. Hashemi' })
    ).toBe('CRA pending · Coordinator V. Hashemi')
    expect(exportDescription({ gap: 'pending_ict', scopeLabel: 'Tehran' })).toBe('ICT pending · Tehran')
    expect(exportDescription({ gap: 'pending_ict' })).toBe('ICT pending')
  })
})

describe('data notes', () => {
  it('lists only what is wrong', () => {
    expect(dataNotes({ villages_without_province: 0, unmapped_provinces: [] })).toEqual([])
    expect(dataNotes({ villages_without_province: 12, unmapped_provinces: ['Ilam'] })).toHaveLength(2)
  })
})

describe('the Mojri stamp', () => {
  it('gives the date and its age', () => {
    // The month abbreviation is the runtime's ("Sep" or "Sept").
    expect(mojriStamp('2026-09-12T08:00:00Z', new Date('2026-09-28T10:00:00Z'))).toMatch(
      /^Mojri import: 12 Sept? 2026 · 16 days ago$/
    )
    expect(mojriStamp(null)).toBe('No Mojri import yet')
  })
})
