// What the sign-in form says, and when.
//
// Kept out of the component so the wording and the mapping from server
// answers can be tested on their own. The server's 401 is the same for an
// unknown username and a wrong password, and so is the sentence here: anything
// more specific tells a stranger which usernames exist. For the same reason the
// username step never asks the server anything (UEP-26).

export const SIGN_IN_MESSAGES = Object.freeze({
  emptyUsername: 'Enter your username.',
  emptyPassword: 'Enter your password.',
  incorrect: 'Username or password is incorrect.',
  unreachable: 'UEP could not be reached. Check your connection and try again.',
  refused: 'You cannot sign in right now.',
  // The server's captcha switch is on (LOGIN_CAPTCHA_ENABLED), but this page
  // no longer shows the question: say so rather than fail silently.
  captchaBlocked: 'Sign-in needs a security check this page does not show. Ask your UEP administrator.',
  sessionExpired: 'Your session expired. Sign in again.',
})

/** The lockout the server applies when Retry-After is missing: 15 minutes. */
export const DEFAULT_LOCKOUT_SECONDS = 15 * 60

/**
 * The server's lockout sentence, in whole minutes rounded up.
 * @param {number} retryAfterSeconds
 * @returns {string}
 */
export function lockoutMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}

/**
 * Seconds as m:ss, for the lockout countdown.
 * @param {number} seconds
 * @returns {string}
 */
export function formatCountdown(seconds) {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** @param {string} username @returns {string | null} the problem, if any */
export function validateUsername(username) {
  return username.trim() ? null : SIGN_IN_MESSAGES.emptyUsername
}

/** Not trimmed: spaces can be part of a password. @param {string} password */
export function validatePassword(password) {
  return password ? null : SIGN_IN_MESSAGES.emptyPassword
}

/**
 * @typedef {{ kind: 'form', message: string, countsAsFailure: boolean }
 *   | { kind: 'lockout', message: string, retryAfter: number }} SignInRefusal
 */

/**
 * Turn a failed sign-in request into what the form shows.
 * @param {any} err  an axios error
 * @returns {SignInRefusal}
 */
export function mapSignInError(err) {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail
  switch (status) {
    case 400:
      return { kind: 'form', message: SIGN_IN_MESSAGES.captchaBlocked, countsAsFailure: false }
    case 401:
      return { kind: 'form', message: SIGN_IN_MESSAGES.incorrect, countsAsFailure: true }
    case 429: {
      const header = Number(err.response.headers?.['retry-after'])
      const retryAfter = Number.isFinite(header) && header > 0 ? Math.ceil(header) : DEFAULT_LOCKOUT_SECONDS
      const message = Number.isFinite(header) && header > 0
        ? lockoutMessage(retryAfter)
        : (typeof detail === 'string' ? detail : lockoutMessage(retryAfter))
      return { kind: 'lockout', message, retryAfter }
    }
    case 403:
      // A suspended account, or a refused cross-site request: the server's
      // own sentence says which.
      return {
        kind: 'form',
        message: typeof detail === 'string' ? detail : SIGN_IN_MESSAGES.refused,
        countsAsFailure: false,
      }
    default:
      return { kind: 'form', message: SIGN_IN_MESSAGES.unreachable, countsAsFailure: false }
  }
}
