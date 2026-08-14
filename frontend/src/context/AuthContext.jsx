// Auth context: single source of truth for the logged-in user and token.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('uep_user')
    if (stored) setUser(JSON.parse(stored))
    setLoading(false)
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
