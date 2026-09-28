import { describe, expect, it } from 'vitest'
import {
  BLOCKS,
  GAPS,
  chartMax,
  checksum,
  columnCaption,
  dataNotes,
  heightPct,
  mojriStamp,
  panelRows,
  summaryLine,
} from './lifecycleGaps'

// The sample figures from the design.
const data = (over = {}) => ({
  last_mojri_import: '2026-09-12T08:00:00Z',
  totals: { eligible: 4812, ict_approved: 2770, cra_approved: 2555 },
  gaps: {
    pending_ict: { count: 2042, base: 4812 },
    pending_cra: { count: 2257, base: 4812 },
    ict_remained: { count: 395, base: 2555 },
    cra_remained: { count: 610, base: 2770 },
    ict_missing_in_mojri: { count: 980, base: 2770, in_tracker: 1790, needs_look: 40 },
    cra_missing_in_mojri: { count: 760, base: 2555, in_tracker: 1795, needs_look: 20 },
  },
  ...over,
})

const row = (name, count, base, attribution = 'owned') => ({ name, count, base, attribution })

describe('the blocks', () => {
  it('puts ICT on the left and CRA on the right of every block', () => {
    for (const block of BLOCKS) {
      expect(block.gaps.map((key) => GAPS[key].authority)).toEqual(['ICT', 'CRA'])
    }
  })
})

describe('the shared scale', () => {
  it('is the largest bar or base drawn on the card', () => {
    // The pending bases (4,812) are not drawn; the tallest thing is 2,770.
    expect(chartMax(data())).toBe(2770)
  })

  it('leaves the Mojri block out when Mojri has never been imported', () => {
    const noMojri = data({ last_mojri_import: null })
    noMojri.gaps.ict_missing_in_mojri.base = 9999
    expect(chartMax(noMojri)).toBe(2770)
  })

  it('draws a zero gap as a zero-height column, not a missing one', () => {
    expect(heightPct(0, 2770)).toBe(0)
    expect(heightPct(2770, 2770)).toBe(100)
    expect(heightPct(5, 0)).toBe(0)
  })
})

describe('captions', () => {
  it('says what each column is counted from', () => {
    expect(columnCaption('pending_ict', data())).toBe('42% of 4,812')
    expect(columnCaption('ict_remained', data())).toBe('of 2,555 CRA-approved')
    expect(columnCaption('cra_remained', data())).toBe('of 2,770 ICT-approved')
    expect(columnCaption('ict_missing_in_mojri', data())).toBe('Mojri has 1,790 of 2,770')
  })

  it('says there is no Mojri import rather than guessing', () => {
    expect(columnCaption('cra_missing_in_mojri', data({ last_mojri_import: null }))).toBe(
      'No Mojri import yet'
    )
  })

  it('summarises a gap in the panel', () => {
    expect(summaryLine('pending_ict', data())).toBe('2,042 villages · 42.4% of 4,812 drive-tested')
  })
})

describe('the panel rows', () => {
  const rows = [
    row('A', 50, 100),
    row('B', 40, 80),
    row('C', 30, 60),
    row('D', 20, 40),
    row('E', 10, 20),
    row('F', 5, 10),
    row('G', 3, 6),
    row('H', 2, 4),
  ]

  it('shows the top six and folds the rest into one row', () => {
    const { shown, more } = panelRows(rows, 160)
    expect(shown.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(more).toMatchObject({ name: '2 more', count: 5, base: 10, folded: 2 })
  })

  it('does not fold a single row into "1 more"', () => {
    const { shown, more } = panelRows(rows.slice(0, 7), 158)
    expect(shown).toHaveLength(7)
    expect(more).toBeNull()
  })

  it('carries both fractions: share of the gap and own rate', () => {
    const [a] = panelRows(rows, 160).shown
    expect(a.share).toBeCloseTo(31.25)
    expect(a.rate).toBe(50)
  })
})

describe('the checksum', () => {
  const rows = [row('A', 290, 400), row('B', 240, 500), row('C', 410, 600)]

  it('says the rows add up when they do', () => {
    expect(checksum(rows, 940, 'province')).toEqual({
      ok: true,
      text: 'All 3 provinces add up to 940',
    })
  })

  it('says so loudly when they do not', () => {
    const result = checksum(rows, 2570, 'coordinator')
    expect(result.ok).toBe(false)
    expect(result.text).toContain('The 3 coordinators add up to 940, not the 2,570 total')
    expect(result.text).toContain('a difference of 1,630')
  })

  it('reads for one row', () => {
    expect(checksum([row('Amir', 230, 300)], 230, 'coordinator').text).toBe(
      'The 1 coordinator adds up to 230'
    )
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
