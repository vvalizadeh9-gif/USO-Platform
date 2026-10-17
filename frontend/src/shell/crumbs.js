import { createContext, useContext, useEffect } from 'react'

/** Lets a page add its own last crumb to the header breadcrumb (a record
 * page's site ID), so the trail lives in the header only (UEP-13 §3.12). */
export const PageCrumbContext = createContext(() => {})

export function usePageCrumb(label) {
  const set = useContext(PageCrumbContext)
  useEffect(() => {
    set(label || null)
    return () => set(null)
  }, [set, label])
}
