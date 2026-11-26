// Admin › Sign-in page (UEP-26): the form model, kept out of the component so
// validation, Tehran-time conversion and "has anything changed" are testable.
//
// Times are entered in Tehran time (UTC+03:30; Iran has kept no daylight
// saving since 2022) and sent to the server as ISO strings with that offset.
// The server stores UTC.

export const TEHRAN_OFFSET_MINUTES = 210
const TEHRAN_OFFSET = '+03:30'

export const LIMITS = Object.freeze({
  support_name: 80,
  support_hours: 80,
  support_phone: 40,
  support_email: 254,
  notice_text: 140,
})

export const MESSAGES = Object.freeze({
  email: 'Enter an email like name@company.com.',
  noticeRequired: 'Enter the message to show on the sign-in page.',
  windowOrder: 'Hide after must be later than Show from.',
  saved: 'Saved. The sign-in page shows the new details now.',
  leave: 'You have unsaved changes to the sign-in page. Leave without saving?',
})

// The server's rule, deliberately plain: catches "name@company", not
// deliverability.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const EMPTY_FORM = Object.freeze({
  support_name: '',
  support_hours: '',
  support_email: '',
  support_phone: '',
  notice_enabled: false,
  notice_text: '',
  notice_from: '',
  notice_to: '',
})

/**
 * An ISO timestamp as a `datetime-local` value in Tehran time.
 * @param {string | null | undefined} iso
 * @returns {string} 'YYYY-MM-DDTHH:mm', or ''
 */
export function toTehranInput(iso) {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Date(ms + TEHRAN_OFFSET_MINUTES * 60_000).toISOString().slice(0, 16)
}

/**
 * A `datetime-local` value, read as Tehran time, as an ISO string.
 * @param {string} value
 * @returns {string | null}
 */
export function fromTehranInput(value) {
  if (!value) return null
  return `${value.length === 16 ? `${value}:00` : value}${TEHRAN_OFFSET}`
}

/** The server's row as form values. */
export function formFromServer(data) {
  if (!data) return { ...EMPTY_FORM }
  return {
    support_name: data.support_name || '',
    support_hours: data.support_hours || '',
    support_email: data.support_email || '',
    support_phone: data.support_phone || '',
    notice_enabled: Boolean(data.notice_enabled),
    notice_text: data.notice_text || '',
    notice_from: toTehranInput(data.notice_from),
    notice_to: toTehranInput(data.notice_to),
  }
}

/** The form as the PUT body: trimmed, empty as null, times with the offset. */
export function toPayload(form) {
  const text = (v) => (v.trim() ? v.trim() : null)
  return {
    support_name: text(form.support_name),
    support_hours: text(form.support_hours),
    support_email: text(form.support_email),
    support_phone: text(form.support_phone),
    notice_enabled: form.notice_enabled,
    notice_text: text(form.notice_text),
    notice_from: fromTehranInput(form.notice_from),
    notice_to: fromTehranInput(form.notice_to),
  }
}

/**
 * @returns {{ support_email?: string, notice_text?: string, notice_to?: string }}
 *   one message per field with a problem; empty when the form can be saved
 */
export function validateForm(form) {
  const errors = {}
  const email = form.support_email.trim()
  if (email && !EMAIL.test(email)) errors.support_email = MESSAGES.email
  if (form.notice_enabled && !form.notice_text.trim()) errors.notice_text = MESSAGES.noticeRequired
  // Both values share one format, so comparing the strings compares the times.
  if (form.notice_from && form.notice_to && form.notice_to <= form.notice_from) {
    errors.notice_to = MESSAGES.windowOrder
  }
  return errors
}

/** Whether the form differs from what was saved (compared as sent). */
export function isDirty(form, saved) {
  return JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(saved))
}

/** What the preview's help panel shows, from the form as typed. */
export function previewSupport(form) {
  const text = (v) => v.trim() || null
  return {
    name: text(form.support_name),
    hours: text(form.support_hours),
    email: text(form.support_email),
    phone: text(form.support_phone),
  }
}

/** "Last saved by Mina Rahimi on 26 Nov 2026", or '' before any save. */
export function lastSavedText(data) {
  if (!data?.updated_at || !data?.updated_by_name) return ''
  const date = new Date(data.updated_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tehran',
  })
  return `Last saved by ${data.updated_by_name} on ${date}`
}
