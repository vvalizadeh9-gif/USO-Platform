import { useEffect } from 'react'

export const LEAVE_MESSAGE = 'You have unsaved access changes. Leave without saving?'

/**
 * While `dirty`, leaving asks first: closing or reloading the tab (the
 * browser's own prompt), and following any in-app link outside `rootRef`
 * (the rail, the launcher, the header). The app uses a plain BrowserRouter,
 * which has no navigation blocker, so links are intercepted on the way out.
 */
export default function useLeaveGuard(dirty, rootRef) {
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event) => {
      const link = event.target.closest?.('a[href]')
      if (!link || rootRef?.current?.contains(link)) return
      if (link.target === '_blank' || event.metaKey || event.ctrlKey) return
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, rootRef])
}
