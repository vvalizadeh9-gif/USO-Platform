import { describe, expect, it } from 'vitest'
import { SIGN_IN_MESSAGES, lockoutMessage, mapSignInError, validateCredentials } from './signInErrors'

const failed = (status, { detail, headers } = {}) => ({ response: { status, data: { detail }, headers: headers ?? {} } })

describe('validateCredentials', () => {
  it('passes when both fields are filled', () => {
    expect(validateCredentials({ username: 'sara', password: 'x' })).toBeNull()
  })

  it.each([
    [{ username: '', password: '' }, { username: true, password: true }],
    [{ username: '  ', password: 'x' }, { username: true, password: false }],
    [{ username: 'sara', password: '' }, { username: false, password: true }],
  ])('asks for both, and marks the empty ones (%o)', (fields, missing) => {
    expect(validateCredentials(fields)).toEqual({ message: 'Enter your username and password.', missing })
  })

  it('does not trim the password: spaces can be part of one', () => {
    expect(validateCredentials({ username: 'sara', password: '   ' })).toBeNull()
  })
})

describe('lockoutMessage', () => {
  it.each([
    [30, 'Too many attempts. Try again in 1 minute.'],
    [61, 'Too many attempts. Try again in 2 minutes.'],
    [900, 'Too many attempts. Try again in 15 minutes.'],
  ])('%is → %s', (seconds, text) => {
    expect(lockoutMessage(seconds)).toBe(text)
  })
})

describe('mapSignInError', () => {
  const ctx = { captchaShown: false }

  it('gives one generic sentence for wrong credentials, and counts it', () => {
    expect(mapSignInError(failed(401), ctx)).toEqual({
      kind: 'form', message: 'Username or password is incorrect.', countsAsFailure: true,
    })
  })

  it('reads the lockout length from Retry-After', () => {
    const result = mapSignInError(failed(429, { headers: { 'retry-after': '840' } }), ctx)
    expect(result.message).toBe('Too many attempts. Try again in 14 minutes.')
    expect(result.countsAsFailure).toBe(false)
  })

  it('falls back to the server sentence when there is no Retry-After', () => {
    const result = mapSignInError(failed(429, { detail: 'Too many attempts. Try again in 3 minutes.' }), ctx)
    expect(result.message).toBe('Too many attempts. Try again in 3 minutes.')
  })

  it('shows the server sentence for a suspended account', () => {
    const result = mapSignInError(failed(403, { detail: 'This account is suspended.' }), ctx)
    expect(result.message).toBe('This account is suspended.')
  })

  it('asks for the security check, then says a wrong answer is wrong', () => {
    expect(mapSignInError(failed(400), ctx)).toEqual({ kind: 'captcha', message: SIGN_IN_MESSAGES.captchaRequired })
    expect(mapSignInError(failed(400), { captchaShown: true })).toEqual({
      kind: 'captcha', message: SIGN_IN_MESSAGES.captchaWrong,
    })
  })

  it('says the platform could not be reached when there is no answer', () => {
    expect(mapSignInError({ message: 'Network Error' }, ctx).message).toBe(SIGN_IN_MESSAGES.unreachable)
    expect(mapSignInError(failed(502), ctx).message).toBe(SIGN_IN_MESSAGES.unreachable)
  })
})
