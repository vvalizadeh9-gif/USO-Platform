import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetUsername, readRememberedUsername, rememberUsername } from './rememberedUsername'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('remembered username', () => {
  it('is empty until something is remembered', () => {
    expect(readRememberedUsername()).toBe('')
  })

  it('remembers and forgets', () => {
    rememberUsername('sara')
    expect(readRememberedUsername()).toBe('sara')
    forgetUsername()
    expect(readRememberedUsername()).toBe('')
  })

  it('survives the session keys being cleared on sign-out', () => {
    rememberUsername('sara')
    localStorage.removeItem('uep_token')
    localStorage.removeItem('uep_user')
    expect(readRememberedUsername()).toBe('sara')
  })

  it('treats storage that throws as nothing remembered', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberUsername('sara')).not.toThrow()
    expect(readRememberedUsername()).toBe('')
  })
})
