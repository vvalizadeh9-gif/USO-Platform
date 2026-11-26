import { describe, expect, it } from 'vitest'
import {
  EMPTY_FORM,
  MESSAGES,
  formFromServer,
  fromTehranInput,
  isDirty,
  lastSavedText,
  toPayload,
  toTehranInput,
  validateForm,
} from './signInSettings'

describe('Tehran time', () => {
  it('shows a UTC time as Tehran time (UTC+03:30)', () => {
    expect(toTehranInput('2026-11-28T18:30:00+00:00')).toBe('2026-11-28T22:00')
    expect(toTehranInput(null)).toBe('')
  })

  it('reads an input as Tehran time', () => {
    expect(fromTehranInput('2026-11-28T22:00')).toBe('2026-11-28T22:00:00+03:30')
    expect(fromTehranInput('')).toBeNull()
  })

  it('round-trips', () => {
    expect(toTehranInput(fromTehranInput('2026-12-01T08:15'))).toBe('2026-12-01T08:15')
  })
})

describe('validateForm', () => {
  const form = (o) => ({ ...EMPTY_FORM, ...o })

  it('accepts an empty form: every field is optional', () => {
    expect(validateForm(EMPTY_FORM)).toEqual({})
  })

  it('checks the email', () => {
    expect(validateForm(form({ support_email: 'name@company' }))).toEqual({ support_email: MESSAGES.email })
    expect(validateForm(form({ support_email: 'name@company.com' }))).toEqual({})
  })

  it('requires the message when the notice is switched on', () => {
    expect(validateForm(form({ notice_enabled: true, notice_text: '  ' }))).toEqual({ notice_text: MESSAGES.noticeRequired })
    expect(validateForm(form({ notice_enabled: false, notice_text: '' }))).toEqual({})
  })

  it('requires Hide after to be later than Show from', () => {
    const same = form({ notice_from: '2026-12-01T10:00', notice_to: '2026-12-01T10:00' })
    expect(validateForm(same)).toEqual({ notice_to: MESSAGES.windowOrder })
    expect(validateForm(form({ notice_from: '2026-12-01T10:00', notice_to: '2026-12-01T11:00' }))).toEqual({})
  })
})

describe('payload and dirty state', () => {
  it('trims, sends empty as null, and adds the Tehran offset', () => {
    expect(toPayload({ ...EMPTY_FORM, support_name: '  Desk ', notice_from: '2026-12-01T10:00' })).toEqual({
      support_name: 'Desk', support_hours: null, support_email: null, support_phone: null,
      notice_enabled: false, notice_text: null, notice_from: '2026-12-01T10:00:00+03:30', notice_to: null,
    })
  })

  it('is not dirty for whitespace alone', () => {
    expect(isDirty({ ...EMPTY_FORM, support_name: '   ' }, EMPTY_FORM)).toBe(false)
    expect(isDirty({ ...EMPTY_FORM, support_name: 'Desk' }, EMPTY_FORM)).toBe(true)
  })

  it('reads the server row', () => {
    expect(formFromServer({ support_name: 'Desk', notice_enabled: true, notice_from: '2026-11-28T18:30:00+00:00' }))
      .toMatchObject({ support_name: 'Desk', support_email: '', notice_enabled: true, notice_from: '2026-11-28T22:00' })
  })
})

describe('lastSavedText', () => {
  it('names who saved and when, in Gregorian', () => {
    expect(lastSavedText({ updated_by_name: 'Mina Rahimi', updated_at: '2026-11-26T09:00:00+00:00' }))
      .toBe('Last saved by Mina Rahimi on 26 Nov 2026')
  })

  it('is empty before the first save', () => {
    expect(lastSavedText({ updated_by_name: null, updated_at: null })).toBe('')
  })
})
