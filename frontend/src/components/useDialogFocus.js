// The keyboard contract every dialog and drawer shares (Modal, Drawer,
// GapDrawer). Kept out of ui.jsx so that file exports components only.
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The keyboard contract every dialog shares: focus moves into the panel when
 * it opens, Tab and Shift+Tab stay inside it, Escape asks to close, and focus
 * goes back to whatever had it before when the panel goes away.
 *
 * Focus lands on the panel's first focusable element, so a dialog whose
 * first control is its Close button opens on Close.
 */
export function useDialogFocus(open, panelRef, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const panel = panelRef.current
    const first = panel?.querySelector(FOCUSABLE)
    ;(first || panel)?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    panel?.addEventListener('keydown', onKeyDown)
    return () => {
      panel?.removeEventListener('keydown', onKeyDown)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, panelRef])
}
