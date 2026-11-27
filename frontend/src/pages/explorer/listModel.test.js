import { beforeEach, describe, expect, it } from 'vitest'
import {
  apiParams, fieldOptions, FILTER_FIELDS, countText, forgetList, isFiltered, lastListSearch, typeTag,
  listParams, nextSort, readListState, recallList, rememberList, splitMatch, typeLabel,
} from './listModel'

const read = (query) => readListState(new URLSearchParams(query))

describe('the list’s URL', () => {
  it('reads search, filters and sort, with the defaults', () => {
    expect(read('')).toEqual({ q: '', filters: {}, sort: 'site', dir: 'asc' })
    expect(read('q=W43&province=3&tech=4G&sort=villages&dir=desc')).toEqual({
      q: 'W43', filters: { province: '3', tech: '4G' }, sort: 'villages', dir: 'desc',
    })
  })

  it('falls back to the default sort for one it does not know', () => {
    expect(read('sort=colour&dir=sideways')).toMatchObject({ sort: 'site', dir: 'asc' })
    // UEP-28: Stage sorts; Type is no longer a column.
    expect(read('sort=stage')).toMatchObject({ sort: 'stage' })
    expect(read('sort=type')).toMatchObject({ sort: 'site' })
  })

  it('writes the state back without the defaults', () => {
    expect(listParams(read('sort=site&dir=asc'))).toEqual({})
    expect(listParams(read('q=x&type=New+Site&sort=stage&dir=desc'))).toEqual({ q: 'x', type: 'New Site', sort: 'stage', dir: 'desc' })
    expect(apiParams(read(''))).toEqual({ sort: 'site', dir: 'asc' })
  })

  it('toggles a column’s direction, and starts a new column ascending', () => {
    expect(nextSort({ sort: 'site', dir: 'asc' }, 'site')).toEqual({ sort: 'site', dir: 'desc' })
    expect(nextSort({ sort: 'site', dir: 'desc' }, 'site')).toEqual({ sort: 'site', dir: 'asc' })
    expect(nextSort({ sort: 'site', dir: 'desc' }, 'province')).toEqual({ sort: 'province', dir: 'asc' })
  })

  it('knows when the view is narrowed', () => {
    expect(isFiltered(read(''))).toBe(false)
    expect(isFiltered(read('sort=stage'))).toBe(false)
    expect(isFiltered(read('q=a'))).toBe(true)
    expect(isFiltered(read('dt_contractor=5'))).toBe(true)
  })
})

describe('the list’s words', () => {
  it('names the site types in sentence case, and tags a row "New" or "Add tech"', () => {
    expect(typeLabel('New Site')).toBe('New site')
    expect(typeLabel('Add Tech')).toBe('Add tech')
    expect(typeLabel('Repeater')).toBe('Repeater')
    expect(typeLabel(null)).toBeNull()
    expect(typeTag('New Site')).toBe('New')
    expect(typeTag('Add Tech')).toBe('Add tech')
    expect(typeTag(null)).toBeNull()
  })

  it('splits text around the first match, case-insensitively', () => {
    expect(splitMatch('W4318', 'w43')).toEqual([{ text: 'W43', match: true }, { text: '18', match: false }])
    expect(splitMatch('W4318', '31')).toEqual([
      { text: 'W4', match: false }, { text: '31', match: true }, { text: '8', match: false },
    ])
    expect(splitMatch('W4318', 'zz')).toEqual([{ text: 'W4318', match: false }])
    expect(splitMatch('W4318', '')).toEqual([{ text: 'W4318', match: false }])
  })

  it('counts "4,201 sites", or "97 of 4,201 sites" while narrowed', () => {
    expect(countText(4201, 4201, false)).toBe('4,201 sites')
    expect(countText(97, 4201, true)).toBe('97 of 4,201 sites')
    expect(countText(1, null, false)).toBe('1 site')
    expect(countText(null, null, true)).toBeNull()
  })

  it('names filter values by id for province and contractor', () => {
    const options = { provinces: [{ id: 3, name: 'کرمان' }], types: ['New Site'] }
    const [province, type] = FILTER_FIELDS
    expect(fieldOptions(province, options)).toEqual([{ value: '3', label: 'کرمان' }])
    expect(fieldOptions(type, options)).toEqual([{ value: 'New Site', label: 'New Site' }])
    expect(fieldOptions(type, null)).toEqual([])
  })
})

describe('coming back to the list', () => {
  beforeEach(() => forgetList())

  it('recalls the view it left, and no other', () => {
    rememberList('?q=a', { items: [1], total: 1, nextCursor: null, scrollTop: 40 }, 1000)
    expect(recallList('?q=a', 2000)).toMatchObject({ items: [1], scrollTop: 40 })
    expect(recallList('?q=b', 2000)).toBeNull()
    expect(lastListSearch()).toBe('?q=a')
  })

  it('forgets it after ten minutes', () => {
    rememberList('', { items: [], total: 0, nextCursor: null, scrollTop: 0 }, 0)
    expect(recallList('', 10 * 60 * 1000 + 1)).toBeNull()
  })
})
