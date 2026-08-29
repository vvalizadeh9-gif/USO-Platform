// Turning an axios failure into a sentence.
//
// The failure mode this exists to prevent is "[object Object]" appearing in
// front of somebody trying to fix a form. FastAPI reports a policy failure as
// a string and a schema failure as a list of per-field objects, and the second
// shape is what a naive render turns into noise — on exactly the errors that
// carry the most useful information.
import { describe, expect, it } from 'vitest'
import { detailMessage, isPasswordChangeRequired } from './apiError'

const withDetail = (detail, status = 400) => ({ response: { status, data: { detail } } })

describe('detailMessage', () => {
  it('passes through a plain string, which is what a policy failure sends', () => {
    expect(
      detailMessage(withDetail('That is one of the most commonly used passwords')),
    ).toBe('That is one of the most commonly used passwords')
  })

  it('names the field on a validation error rather than rendering the object', () => {
    expect(
      detailMessage(
        withDetail([{ loc: ['body', 'email'], msg: 'Enter an email address' }], 422),
      ),
    ).toBe('email: Enter an email address')
  })

  it('drops the "body" and "query" prefixes, which mean nothing to the reader', () => {
    const text = detailMessage(
      withDetail([{ loc: ['body', 'password'], msg: 'Use at least 12 characters' }], 422),
    )
    expect(text).not.toContain('body')
    expect(text).toContain('password')
  })

  it('still says something when a validation error has no location', () => {
    expect(detailMessage(withDetail([{ msg: 'Something is wrong' }], 422)))
      .toBe('Something is wrong')
  })

  it('reads the message out of the password-change gate object', () => {
    expect(
      detailMessage(
        withDetail({ code: 'password_change_required', message: 'Choose a new one.' }, 403),
      ),
    ).toBe('Choose a new one.')
  })

  it('falls back rather than returning undefined for a shape it does not know', () => {
    expect(detailMessage({})).toBeTruthy()
    expect(detailMessage(null)).toBeTruthy()
    expect(detailMessage(withDetail([]))).toBeTruthy()
    expect(detailMessage({ message: 'Network Error' })).toBeTruthy()
  })

  it("uses the caller's fallback when there is one", () => {
    expect(detailMessage({}, 'Please try again.')).toBe('Please try again.')
  })
})

describe('isPasswordChangeRequired', () => {
  it('recognises the gate', () => {
    expect(
      isPasswordChangeRequired(withDetail({ code: 'password_change_required' }, 403)),
    ).toBe(true)
  })

  it('does not mistake an ordinary 403 for it', () => {
    // Every permission refusal in the platform is a 403. Treating them all as
    // "go and change your password" would redirect people away from screens
    // they simply may not use.
    expect(isPasswordChangeRequired(withDetail('You may not do that', 403))).toBe(false)
    expect(isPasswordChangeRequired(withDetail({ code: 'something_else' }, 403))).toBe(false)
  })

  it('does not mistake the same code on a different status for it', () => {
    expect(
      isPasswordChangeRequired(withDetail({ code: 'password_change_required' }, 400)),
    ).toBe(false)
  })

  it('survives an error that never reached the server', () => {
    expect(isPasswordChangeRequired({ message: 'Network Error' })).toBe(false)
    expect(isPasswordChangeRequired(undefined)).toBe(false)
  })
})
