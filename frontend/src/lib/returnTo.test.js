import { describe, expect, it } from 'vitest'
import { loginPathFor, returnPathFrom, safeReturnPath } from './returnTo'

describe('safeReturnPath', () => {
  it.each([
    ['/my-work', '/my-work'],
    ['/reports/gaps?tab=mojri', '/reports/gaps?tab=mojri'],
    ['/work-items/42#history', '/work-items/42#history'],
  ])('keeps a path on this site: %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected)
  })

  it.each([
    ['another origin', 'https://evil.example/phish'],
    ['protocol-relative', '//evil.example'],
    ['backslash form', '/\\evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'my-work'],
    ['control characters', '/my-work\n//evil.example'],
    ['the sign-in screen', '/login'],
    ['the sign-in screen with a query', '/login?next=/my-work'],
    ['empty', ''],
    ['missing', null],
  ])('drops %s', (_label, input) => {
    expect(safeReturnPath(input)).toBeNull()
  })
})

describe('loginPathFor', () => {
  it('carries the page, query and fragment', () => {
    expect(loginPathFor({ pathname: '/my-work', search: '?village=12', hash: '#ict' })).toBe(
      `/login?next=${encodeURIComponent('/my-work?village=12#ict')}`,
    )
  })

  it('says nothing for the home page', () => {
    expect(loginPathFor({ pathname: '/' })).toBe('/login')
  })

  it('does not point the sign-in screen back at itself', () => {
    expect(loginPathFor({ pathname: '/login', search: '?next=/x' })).toBe('/login')
  })
})

describe('returnPathFrom', () => {
  it('reads a safe next', () => {
    expect(returnPathFrom(`?next=${encodeURIComponent('/my-work?village=12')}`)).toBe('/my-work?village=12')
  })

  it('ignores an unsafe one', () => {
    expect(returnPathFrom('?next=https://evil.example')).toBeNull()
  })

  it('returns null when there is none', () => {
    expect(returnPathFrom('')).toBeNull()
  })
})
