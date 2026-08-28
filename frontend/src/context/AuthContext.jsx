// Auth context: single source of truth for the logged-in user and token.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
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

  async function login(username, password, captchaToken, captchaAnswer) {
    // OAuth2 password flow expects form-encoded fields.
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    form.append('captcha_token', captchaToken)
    form.append('captcha_answer', captchaAnswer)
    const { data } = await api.post('/auth/login', form)
    localStorage.setItem('uep_token', data.access_token)
    localStorage.setItem('uep_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  function logout() {
    localStorage.removeItem('uep_token')
    localStorage.removeItem('uep_user')
    setUser(null)
  }

  const value = useMemo(
    () => ({ user, loading, login, logout, isAdmin: user?.role?.name === 'Admin' }),
    [user, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
