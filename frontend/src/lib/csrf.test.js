import { afterEach, describe, expect, it } from 'vitest'
import { csrfHeaders, isUnsafeMethod, readCsrfToken } from './csrf'

afterEach(() => {
  document.cookie = 'uep_csrf=; max-age=0; path=/'
})

describe('csrf', () => {
  it('reads the token out of a cookie string', () => {
    expect(readCsrfToken('a=1; uep_csrf=abc%3D; b=2')).toBe('abc=')
    expect(readCsrfToken('a=1')).toBeNull()
  })

  it('treats only reads as safe', () => {
    expect(isUnsafeMethod('get')).toBe(false)
    expect(isUnsafeMethod('HEAD')).toBe(false)
    expect(isUnsafeMethod('post')).toBe(true)
    expect(isUnsafeMethod('delete')).toBe(true)
  })

  it('adds the header to writes only, and only when there is a token', () => {
    expect(csrfHeaders('post')).toEqual({})
    document.cookie = 'uep_csrf=tok; path=/'
    expect(csrfHeaders('post')).toEqual({ 'X-CSRF-Token': 'tok' })
    expect(csrfHeaders('get')).toEqual({})
  })
})
