import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCKOUT_SECONDS,
  SIGN_IN_MESSAGES,
  formatCountdown,
  lockoutMessage,
  mapSignInError,
  validatePassword,
  validateUsername,
} from './signInErrors'

const failed = (status, { detail, headers } = {}) => ({ response: { status, data: { detail }, headers: headers ?? {} } })

describe('validateUsername / validatePassword', () => {
  it('asks for a username when it is empty or blank', () => {
    expect(validateUsername('')).toBe('Enter your username.')
    expect(validateUsername('   ')).toBe('Enter your username.')
    expect(validateUsername('sara')).toBeNull()
  })

  it('asks for a password, and does not trim it: spaces can be part of one', () => {
    expect(validatePassword('')).toBe('Enter your password.')
    expect(validatePassword('   ')).toBeNull()
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

describe('formatCountdown', () => {
  it.each([[90, '1:30'], [900, '15:00'], [5, '0:05'], [0, '0:00'], [-3, '0:00'], [59.2, '1:00']])(
    '%s → %s',
    (seconds, text) => {
      expect(formatCountdown(seconds)).toBe(text)
    },
  )
})

describe('mapSignInError', () => {
  it('gives one generic sentence for wrong credentials, and counts it', () => {
    expect(mapSignInError(failed(401))).toEqual({
      kind: 'form', message: 'Username or password is incorrect.', countsAsFailure: true,
    })
  })

  it('reads the lockout length from Retry-After', () => {
    expect(mapSignInError(failed(429, { headers: { 'retry-after': '840' } }))).toEqual({
      kind: 'lockout', retryAfter: 840, message: 'Too many attempts. Try again in 14 minutes.',
    })
  })

  it('falls back to 15 minutes and the server sentence when there is no Retry-After', () => {
    const result = mapSignInError(failed(429, { detail: 'Too many attempts. Try again in 3 minutes.' }))
    expect(result).toEqual({
      kind: 'lockout', retryAfter: DEFAULT_LOCKOUT_SECONDS, message: 'Too many attempts. Try again in 3 minutes.',
    })
  })

  it('shows the server sentence for a suspended account', () => {
    expect(mapSignInError(failed(403, { detail: 'This account is suspended.' })).message).toBe('This account is suspended.')
  })

  it('says plainly when the server wants a security check the page does not show', () => {
    expect(mapSignInError(failed(400)).message).toBe(SIGN_IN_MESSAGES.captchaBlocked)
  })

  it('says the platform could not be reached when there is no answer', () => {
    expect(mapSignInError({ message: 'Network Error' }).message).toBe(SIGN_IN_MESSAGES.unreachable)
    expect(mapSignInError(failed(502)).message).toBe(SIGN_IN_MESSAGES.unreachable)
  })
})
