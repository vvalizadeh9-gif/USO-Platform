import { describe, expect, it } from 'vitest'
import { cellClass, filingLink, grouped, heatStep, initials } from './basketsModel'

describe('basketsModel', () => {
  it('scales a cell in five steps against its column', () => {
    expect(heatStep(0, 10)).toBe(0)
    expect(heatStep(1, 100)).toBe(1)
    expect(heatStep(100, 100)).toBe(5)
    expect(cellClass('u3', 50, 100)).toBe('is-blue-3')
    expect(cellClass('o1y', 50, 100)).toBe('is-red-3')
    expect(cellClass('m3_6', 0, 100)).toBe('is-zero')
  })

  it('groups rows under their captions', () => {
    const rows = [{ group: 'A', key: 1 }, { group: 'A', key: 2 }, { group: 'B', key: 3 }]
    expect(grouped(rows).map((g) => [g.label, g.rows.length])).toEqual([['A', 2], ['B', 1]])
  })

  it('links a cell into Filing with its filter', () => {
    expect(filingLink({ basket: 'team:CpgPower', column: 'm3_6', authority: 'both' }))
      .toBe('/filing?authority=ICT&basket=team%3ACpgPower&bucket=m3_6')
    expect(filingLink({ basket: 'parked', column: 'total', authority: 'cra' })).toBe('/filing?authority=CRA&basket=parked')
  })

  it('marks a basket with two letters', () => {
    expect(initials('Contractor A')).toBe('CA')
    expect(initials('PM')).toBe('PM')
    expect(initials('Contractors (rejected)')).toBe('CR')
  })
})
