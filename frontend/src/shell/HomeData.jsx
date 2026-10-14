import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { DATA_CHANGED_EVENT } from '../lib/dataChanged'
import { hasHome } from '../lib/roles'
import { BACKGROUND_HEADERS } from '../lib/session'
import { queueCounts } from './appRegistry'

/**
 * GET /me/home, read once for the whole shell. Home, the Apps panel, the app
 * rails, the launcher and the notification badge all read this one response,
 * so a count is the same number on every surface (UEP-02 §3.6). Re-read after
 * any write anywhere in the app and on a light interval; the server caches it
 * per user for a few seconds and empties that cache on every commit.
 */
const REFRESH_MS = 60000
const HomeDataContext = createContext({ data: null, error: null, counts: {}, reload: () => {}, enabled: false })

export function HomeDataProvider({ children }) {
  const { user, mustChangePassword } = useAuth()
  const enabled = Boolean(user) && !mustChangePassword && hasHome(user?.role?.name)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  // `background` for the timer: a refresh nobody asked for must not keep an
  // unattended session alive (lib/session.js).
  const reload = useCallback((background = false) => {
    if (!enabled) return Promise.resolve()
    return api
      .get('/me/home', background === true ? { headers: BACKGROUND_HEADERS } : undefined)
      .then((r) => {
        setData(r.data)
        setError(null)
      })
      .catch((e) => setError(e?.response?.status === 403 ? 'forbidden' : 'failed'))
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let pending = null
    const onChange = () => {
      clearTimeout(pending)
      pending = setTimeout(reload, 300)
    }
    reload()
    const id = setInterval(() => reload(true), REFRESH_MS)
    window.addEventListener(DATA_CHANGED_EVENT, onChange)
    return () => {
      clearInterval(id)
      clearTimeout(pending)
      window.removeEventListener(DATA_CHANGED_EVENT, onChange)
    }
  }, [enabled, reload])

  const value = useMemo(
    () => ({ data, error, counts: queueCounts(data), reload, enabled }),
    [data, error, reload, enabled],
  )
  return <HomeDataContext.Provider value={value}>{children}</HomeDataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useHomeData = () => useContext(HomeDataContext)
