import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import { canUndo, logAction, markAction } from '../../lib/actionLog'

/**
 * What every part of a work page shares (UEP-06 §4.2, §6, §8):
 *
 * * one persistent, visually hidden `role="status"` region that exists from
 *   page load and announces every result -- never a region created with the
 *   message, which screen readers often miss;
 * * the on-screen confirmation of the last action ("✓ 2 sites assigned to
 *   …"), which stays until dismissed or the next selection -- it never times
 *   out (WCAG 2.2.1);
 * * Undo, and `version`, which every list and the strip reload on;
 * * the page heading, which takes focus after an action.
 */
const WorkContext = createContext(null)

export const UNDONE_TEXT = 'Undone. The sites are back where they were.'
export const TOO_LATE_TEXT = 'Too late to undo; reassign the sites instead.'

export function WorkProvider({ children }) {
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState(null) // { text, actionId, tone } | null
  const [version, setVersion] = useState(0)
  const headingRef = useRef(null)

  // The same words twice in a row are still announced: the region is cleared
  // first so the change is a change.
  const announce = useCallback((text) => {
    setMessage('')
    requestAnimationFrame(() => setMessage(text))
  }, [])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const focusHeading = useCallback(() => headingRef.current?.focus(), [])

  /** Record an undoable action, show and announce its confirmation. */
  const confirmAction = useCallback(
    ({ text, undoUrl }) => {
      const actionId = undoUrl ? logAction({ label: text, undoUrl }) : null
      setNotice({ text, actionId, tone: 'done' })
      announce(text)
      refresh()
      focusHeading()
    },
    [announce, refresh, focusHeading],
  )

  const undo = useCallback(
    async (action) => {
      if (!canUndo(action)) {
        setNotice({ text: TOO_LATE_TEXT, actionId: null, tone: 'refused' })
        announce(TOO_LATE_TEXT)
        return false
      }
      try {
        await api.post(action.undoUrl)
        markAction(action.id, 'undone')
        setNotice({ text: UNDONE_TEXT, actionId: null, tone: 'done' })
        announce(UNDONE_TEXT)
        refresh()
        return true
      } catch (err) {
        const text = err.response?.status === 409 ? TOO_LATE_TEXT : err.response?.data?.detail || 'Could not undo. Please try again.'
        if (err.response?.status === 409) markAction(action.id, 'refused')
        setNotice({ text, actionId: null, tone: 'refused' })
        announce(text)
        return false
      } finally {
        focusHeading()
      }
    },
    [announce, refresh, focusHeading],
  )

  const value = useMemo(
    () => ({
      announce, notice, setNotice, clearNotice: () => setNotice(null),
      confirmAction, undo, version, refresh, headingRef, focusHeading,
    }),
    [announce, notice, confirmAction, undo, version, refresh, focusHeading],
  )

  return (
    <WorkContext.Provider value={value}>
      {children}
      <div className="uw-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="work-live">
        {message}
      </div>
    </WorkContext.Provider>
  )
}

export function useWork() {
  const ctx = useContext(WorkContext)
  if (!ctx) throw new Error('useWork must be used within WorkProvider')
  return ctx
}
