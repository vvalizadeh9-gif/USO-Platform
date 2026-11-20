import { describe, expect, it } from 'vitest'
import {
  allowedChoices,
  basketFor,
  choiceTiles,
  commentLine,
  commentPlaceholder,
  missingFields,
  nextVillage,
  stepVillage,
} from './filingModel'

const rows = [{ village_id: 1 }, { village_id: 2 }, { village_id: 3 }]

describe('filingModel', () => {
  it('words the first tile by the case state', () => {
    expect(choiceTiles('waiting')[0].label).toBe('Waiting · add comment')
    expect(choiceTiles('rejected')[0].label).toBe('Fixed · back to contractor')
  })

  it('offers a team only the fix, and a viewer nothing', () => {
    const team = { fix: true, comment: false, record_letters: false, read_only: false }
    expect(allowedChoices(team, 'rejected')).toEqual(['waiting'])
    expect(allowedChoices({ read_only: true }, 'waiting')).toEqual([])
    const pm = { fix: true, comment: true, record_letters: true, read_only: false }
    expect(allowedChoices(pm, 'waiting')).toEqual(['waiting', 'approved', 'rejected'])
  })

  it('placeholders follow the choice', () => {
    expect(commentPlaceholder('waiting', 'waiting', 'ICT')).toBe('Latest follow-up with ICT')
    expect(commentPlaceholder('waiting', 'rejected', 'ICT')).toBe('What was fixed?')
    expect(commentPlaceholder('approved', 'waiting', 'CRA')).toBe('Anything to note')
    expect(commentPlaceholder('rejected', 'waiting', 'CRA')).toBe('Why did CRA reject?')
  })

  it('names the basket a category goes to', () => {
    expect(basketFor({ basket_role: 'Contractor', label: 'Contractor' }, 'Contractor A')).toBe('Contractor A')
    expect(basketFor({ basket_role: 'PM', label: 'Parked' })).toBe('PM')
    expect(basketFor({ basket_role: 'CpgPower', label: 'CPG Power' })).toBe('CPG Power')
  })

  it('requires the fields of each choice', () => {
    expect(missingFields({ choice: 'waiting', comment: '' })).toEqual({ comment: 'missing' })
    expect(Object.keys(missingFields({ choice: 'rejected', comment: 'x' })).sort()).toEqual(
      ['category', 'letter_date', 'letter_no', 'scan'],
    )
  })

  it('moves through the rows', () => {
    expect(nextVillage(rows, 3)).toBe(1)
    expect(nextVillage([{ village_id: 9 }], 9)).toBe(null)
    expect(stepVillage(rows, 1, -1)).toBe(1)
    expect(stepVillage(rows, 2, 1)).toBe(3)
  })

  it('flags a stale comment', () => {
    expect(commentLine({ stale: true, age_days: null }).text).toBe('No comment yet')
    expect(commentLine({ stale: true, age_days: 12 }).text).toBe('Last comment 12 d ago · needs an update')
    expect(commentLine({ stale: false, text: 'Sent', author: 'Ali', age_days: 2 }).text).toBe('“Sent” · Ali, 2 d ago')
  })
})
