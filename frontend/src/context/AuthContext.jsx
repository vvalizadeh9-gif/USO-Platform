// Auth context: single source of truth for the logged-in user and token.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Guarded, because this runs before anything renders. An unparseable
    // uep_user threw here and took the whole application down with it -- and
    // the login screen is behind the same render, so the user got a blank page
    // with no way back except clearing site data by hand, which nothing on the
    // page could tell them to do.
    //
    // localStorage itself can also throw, not only its contents: a browser set
    // to block site data raises on access rather than returning null.
    try {
      const stored = localStorage.getItem('uep_user')
      if (stored) setUser(JSON.parse(stored))
    } catch {
      // Unreadable means signed out. Clear both keys so the next load starts
      // clean rather than hitting the same value again.
      try {
        localStorage.removeItem('uep_user')
        localStorage.removeItem('uep_token')
      } catch {
        // Storage is unavailable entirely; there is nothing to clear.
      }
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  function store(nextUser) {
    setUser(nextUser)
    try {
      localStorage.setItem('uep_user', JSON.stringify(nextUser))
    } catch {
      // Storage unavailable. The user stays in memory for this tab, which is
      // enough to keep working; only the reload shortcut is lost.
    }
  }

  async function login(username, password, captchaToken, captchaAnswer) {
    // OAuth2 password flow expects form-encoded fields.
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    form.append('captcha_token', captchaToken)
    form.append('captcha_answer', captchaAnswer)
    const { data } = await api.post('/auth/login', form)
    localStorage.setItem('uep_token', data.access_token)
    store(data.user)
    return data.user
  }

  // Re-read the account from the server. Called after a password change, so
  // that must_change_password clearing is reflected without a sign-out — the
  // cached copy in localStorage would otherwise keep the interface locked on
  // the change-password screen until the next sign-in.
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me')
      store(data)
      return data
    } catch {
      return null
    }
  }, [])

  function clearSession() {
    try {
      localStorage.removeItem('uep_token')
      localStorage.removeItem('uep_user')
    } catch {
      // Nothing to clear.
    }
    setUser(null)
  }

  async function logout() {
    // Tell the server first, so "signed out" reaches the audit log — a session
    // that simply stops being used leaves no trace of when its holder stopped
    // working. The token is not revoked server-side: that would sign this
    // person out on every other device too, which is not what the button says.
    //
    // Failure here must not trap anyone in a session they asked to leave, so
    // the local clear happens either way.
    try {
      await api.post('/auth/logout')
    } catch {
      // Already expired, or the network is down. Signing out locally is still
      // the right outcome.
    }
    clearSession()
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      isAdmin: user?.role?.name === 'Admin',
      // True while the account is on a password an administrator issued. Every
      // endpoint but /auth/me, /auth/me/password and /auth/logout refuses, so
      // the interface routes to the change-password screen rather than showing
      // a platform full of things that will not work.
      mustChangePassword: !!user?.must_change_password,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
