// How a page uses the space under the app shell.
//
// The shell never scrolls the browser page. What scrolls depends on the page:
//
// * **scroll** (the default) -- the page's content scrolls inside `.page-outlet`,
//   with the app's usual padding and 1,280px cap. Every page that has not been
//   redesigned for one screen keeps working as it did.
// * **fill** -- the page takes exactly the height left under the shell, and
//   its long lists scroll inside their own cards. Opted into by rendering
//   `<PageFrame>`, which registers itself here while it is mounted.
//
// A context rather than a list of routes in Layout: the same URL can hold a
// fill page for one role and a scrolling one for another (Monthly Plan is a
// one-screen board for a PM and a long form for a contractor), and only the
// page knows which it rendered.
import { createContext, useContext, useLayoutEffect } from 'react'

export const PAGE_MODE = { scroll: 'scroll', fill: 'fill' }

export const PageModeContext = createContext({ setMode: () => {} })

/** Put the shell in fill mode while the calling component is mounted.
 *
 * A layout effect, so the mode is set before the first paint and the page
 * never flashes in the padded scrolling frame first. */
export function useFillPage() {
  const { setMode } = useContext(PageModeContext)
  useLayoutEffect(() => {
    setMode(PAGE_MODE.fill)
    return () => setMode(PAGE_MODE.scroll)
  }, [setMode])
}
