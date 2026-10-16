import { describe, expect, it } from 'vitest'
import { crumbsFor } from './AppShell'
import { appsFor } from './appRegistry'

describe('header breadcrumb (UEP-13 §3.12)', () => {
  const explorer = appsFor('PM').find((a) => a.id === 'explorer')

  it('reads UEP / Explorer / W4303 on a record page, Explorer linking back with its filters', () => {
    expect(crumbsFor('/explorer/sites/7', explorer, 'W4303', '?province=1')).toEqual([
      { label: 'Explorer', to: '/explorer?province=1', state: { app: 'explorer' } },
      { label: 'W4303' },
    ])
  })

  it('is just the app on the list, and nothing on Home', () => {
    expect(crumbsFor('/explorer', explorer)).toEqual([{ label: 'Explorer', to: '/explorer', state: { app: 'explorer' } }])
    expect(crumbsFor('/home', explorer)).toEqual([])
  })
})
