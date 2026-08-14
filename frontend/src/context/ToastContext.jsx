// Lightweight toast system for success/error feedback.
import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

let idSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((toast) => {
    const id = ++idSeq
    setToasts((t) => [...t, { id, ...toast }])
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, toast.duration || 4000)
  }, [])

  const api = {
    success: (title, body) => push({ kind: 'success', title, body }),
    error: (title, body) => push({ kind: 'error', title, body }),
    info: (title, body) => push({ kind: 'info', title, body }),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.kind}`}
              role={t.kind === 'error' ? 'alert' : 'status'}
              aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <b>{t.title}</b>
              {t.body && <small>{t.body}</small>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
