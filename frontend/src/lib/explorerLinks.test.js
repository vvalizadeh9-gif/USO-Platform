import { describe, expect, it } from 'vitest'
import { explorerListPath, myWorkPath, siteRecordPath } from './explorerLinks'

describe('explorer links', () => {
  it('builds the list path with only the filters given', () => {
    expect(explorerListPath()).toBe('/explorer')
    expect(explorerListPath({ q: 'W43 18', province: '', dt_contractor: null })).toBe('/explorer?q=W43+18')
  })

  it('builds the record path, with the village highlighted when named', () => {
    expect(siteRecordPath(7)).toBe('/explorer/sites/7')
    expect(siteRecordPath(7, 'V10232')).toBe('/explorer/sites/7?village=V10232')
  })

  it('builds the My Work path narrowed to a site', () => {
    expect(myWorkPath({ q: 'W4318' })).toBe('/my-work?q=W4318')
    expect(myWorkPath({ q: 'W4318', tab: 'your_move' })).toBe('/my-work?tab=your_move&q=W4318')
  })
})
