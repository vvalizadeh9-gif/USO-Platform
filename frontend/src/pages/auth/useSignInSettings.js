// The sign-in page's support contact and planned-update notice (UEP-26),
// set by Admin in Admin › Sign-in page and read without signing in.
//
// A failure leaves the defaults: no notice, and "Contact details have not
// been set yet." in the help panel. The page must never fail to sign anyone
// in because this read did.
import { useEffect, useState } from 'react'
import api from '../../api/client'

/** @typedef {{ name: string|null, hours: string|null, email: string|null, phone: string|null }} Support */
/** @typedef {{ support: Support, notice: { text: string } | null }} SignInSettings */

/** @type {SignInSettings} */
export const EMPTY_SETTINGS = Object.freeze({
  support: Object.freeze({ name: null, hours: null, email: null, phone: null }),
  notice: null,
})

/** @returns {SignInSettings} */
export function useSignInSettings() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS)
  useEffect(() => {
    let live = true
    api
      .get('/auth/signin-settings')
      .then(({ data }) => {
        if (live && data?.support) setSettings({ support: data.support, notice: data.notice || null })
      })
      .catch(() => {
        // Keep the defaults.
      })
    return () => {
      live = false
    }
  }, [])
  return settings
}
