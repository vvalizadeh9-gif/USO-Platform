// What the sign-in form says, and when.
//
// Kept out of the component so the wording and the mapping from server
// answers can be tested on their own. The server's 401 is the same for an
// unknown username and a wrong password, and so is the sentence here: anything
// more specific tells a stranger which usernames exist.

export const SIGN_IN_MESSAGES = Object.freeze({
  empty: 'Enter your username and password.',
  incorrect: 'Username or password is incorrect.',
  unreachable: 'UEP could not be reached. Check your connection and try again.',
  refused: 'You cannot sign in right now.',
  captchaRequired: 'Answer the security check to sign in.',
  captchaWrong: 'The answer is not right. Try the new question.',
  captchaNotANumber: 'Enter the answer as a number.',
  sessionExpired: 'Your session expired. Sign in again.',
})

/**
 * @param {number} retryAfterSeconds
 * @returns {string}
 */
export function lockoutMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}

/**
 * Check the fields before anything is sent.
 * @param {{ username: string, password: string }} fields
 * @returns {{ message: string, missing: { username: boolean, password: boolean } } | null}
 */
export function validateCredentials({ username, password }) {
  const missing = { username: !username.trim(), password: !password }
  if (!missing.username && !missing.password) return null
  return { message: SIGN_IN_MESSAGES.empty, missing }
}

/**
 * @typedef {{ kind: 'form', message: string, countsAsFailure: boolean }
 *   | { kind: 'captcha', message: string }} SignInRefusal
 */

/**
 * Turn a failed sign-in request into what the form shows.
 * @param {any} err  an axios error
 * @param {{ captchaShown: boolean }} context
 * @returns {SignInRefusal}
 */
export function mapSignInError(err, { captchaShown }) {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail
  switch (status) {
    case 400:
      // The server wants the security check, or the answer was wrong.
      return {
        kind: 'captcha',
        message: captchaShown ? SIGN_IN_MESSAGES.captchaWrong : SIGN_IN_MESSAGES.captchaRequired,
      }
    case 401:
      return { kind: 'form', message: SIGN_IN_MESSAGES.incorrect, countsAsFailure: true }
    case 429: {
      const retryAfter = Number(err.response.headers?.['retry-after'])
      const message = Number.isFinite(retryAfter) && retryAfter > 0
        ? lockoutMessage(retryAfter)
        : (typeof detail === 'string' ? detail : lockoutMessage(15 * 60))
      return { kind: 'form', message, countsAsFailure: false }
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
